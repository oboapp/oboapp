import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import {
  buildFacebookAuthorizationUrl,
  exchangeFacebookCode,
  FacebookAuthorizationError,
  getFacebookAuthorization,
  getFacebookPageAccess,
} from "./client";
import {
  FACEBOOK_SESSION_DURATION_MS,
  getFacebookConnectConfig,
  type FacebookConnectConfig,
} from "./config";
import {
  facebookCsrfToken,
  facebookUserHash,
  hashFacebookValue,
  hashFacebookNetworkIdentifier,
  makeFacebookSession,
  matchesFacebookBrowser,
  openFacebookUserToken,
  parseFacebookSessionCookie,
  sealFacebookUserToken,
  validateFacebookCsrf,
} from "./crypto";
import { createFacebookSecretStore, type FacebookSecretStore } from "./secret-store";
import { createFacebookConnectStore, type FacebookConnectStore } from "./store";
import type {
  FacebookConnectionErrorCode,
  FacebookConnectionRecord,
  FacebookConnectionView,
  FacebookOAuthSession,
} from "./types";

export class FacebookConnectionFlowError extends Error {
  constructor(readonly code: FacebookConnectionErrorCode) {
    super("Facebook connection could not be completed");
    this.name = "FacebookConnectionFlowError";
  }
}

export interface FacebookConnectionContext {
  config: FacebookConnectConfig;
  store: FacebookConnectStore;
  secrets: FacebookSecretStore;
  now: () => number;
}

export async function getFacebookConnectionContext(): Promise<FacebookConnectionContext> {
  const config = getFacebookConnectConfig();
  if (!config) {
    throw new FacebookConnectionFlowError("storage");
  }
  return {
    config,
    store: createFacebookConnectStore((await getDb()).client),
    secrets: createFacebookSecretStore(config),
    now: Date.now,
  };
}

export function facebookFlowErrorCode(error: unknown): FacebookConnectionErrorCode {
  if (error instanceof FacebookConnectionFlowError || error instanceof FacebookAuthorizationError) {
    return error.code;
  }
  return "storage";
}

async function attemptTwice(action: () => Promise<void>): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await action();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function requireUnrevokedSession(
  context: FacebookConnectionContext,
  session: FacebookOAuthSession,
  userHash: string,
): Promise<void> {
  const revokedAt = await context.store.getUserRevocation(userHash);
  const startedAt = session.expiresAt - FACEBOOK_SESSION_DURATION_MS;
  if (revokedAt !== null && startedAt <= revokedAt) {
    throw new FacebookConnectionFlowError("invalid");
  }
}

async function clearTemporaryCredentials(context: FacebookConnectionContext, sessionId: string): Promise<void> {
  const cleared = await attemptTwice(async () => {
    const session = await context.store.getSession(sessionId);
    if (session && (session.userTokenCipher !== null || session.pages.length > 0)) {
      await context.store.updateSession(sessionId, { userTokenCipher: null, pages: [] });
    }
  });
  if (!cleared) {
    throw new FacebookConnectionFlowError("storage");
  }
}

async function settleSelection(
  context: FacebookConnectionContext,
  sessionId: string,
  cleanupPending: boolean,
): Promise<boolean> {
  const settled = await attemptTwice(async () => {
    await context.store.setSessionCleanupIntent(sessionId, cleanupPending);
  });
  try {
    await clearTemporaryCredentials(context, sessionId);
  } catch {
    return false;
  }
  return settled;
}

async function failSession(context: FacebookConnectionContext, sessionId: string, keepCleanupIntent = false): Promise<void> {
  await attemptTwice(async () => {
    const session = await context.store.getSession(sessionId);
    if (session && session.phase !== "failed") {
      await context.store.transitionSession(sessionId, session.phase, "failed", {
        userTokenCipher: null, pages: [],
        ...(keepCleanupIntent ? {} : { connectionId: null, pageName: null }),
      });
    }
  });
  await clearTemporaryCredentials(context, sessionId);
}

async function retireConnection(
  context: FacebookConnectionContext,
  connection: FacebookConnectionRecord,
): Promise<void> {
  await attemptTwice(async () => {
    await context.store.trackConnectionCleanup(connection.id, connection);
  });
  const destroyed = await attemptTwice(async () => {
    await context.secrets.destroy(connection.secretVersion);
  });
  if (!destroyed) {
    await attemptTwice(async () => {
      await context.secrets.disable(connection.secretVersion);
    });
    throw new FacebookConnectionFlowError("storage");
  }
  await context.store.deleteConnection(connection.id);
}

async function requireSession(
  context: FacebookConnectionContext,
  cookieValue: string | undefined,
): Promise<FacebookOAuthSession> {
  const cookie = cookieValue ? parseFacebookSessionCookie(cookieValue) : null;
  if (!cookie) {
    throw new FacebookConnectionFlowError("expired");
  }
  const session = await context.store.getSession(cookie.id);
  if (!session || !matchesFacebookBrowser(session.browserHash, cookie.browserSecret)) {
    throw new FacebookConnectionFlowError("invalid");
  }
  if (session.expiresAt <= context.now()) {
    await context.store.updateSession(session.id, { userTokenCipher: null, pages: [] });
    throw new FacebookConnectionFlowError("expired");
  }
  if (session.userHash) {
    await requireUnrevokedSession(context, session, session.userHash);
  }
  return session;
}

export async function startFacebookConnection(
  context: FacebookConnectionContext,
  networkIdentifier: string,
): Promise<{ location: string; cookieValue: string }> {
  const key = hashFacebookNetworkIdentifier(context.config, networkIdentifier);
  if (!await context.store.consumeStartLimit(key, context.now())) {
    throw new FacebookConnectionFlowError("rate_limit");
  }
  const session = makeFacebookSession();
  await context.store.createSession(session.sessionId, {
    browserHash: hashFacebookValue(session.browserSecret),
    expiresAt: context.now() + FACEBOOK_SESSION_DURATION_MS,
  });
  return {
    location: buildFacebookAuthorizationUrl(context.config, session.state),
    cookieValue: session.cookieValue,
  };
}

export async function finishFacebookAuthorization(
  context: FacebookConnectionContext,
  cookieValue: string | undefined,
  input: { state: string | null; code: string | null; denied: boolean },
): Promise<void> {
  const session = await requireSession(context, cookieValue);
  if (
    !input.state || input.state.length > 128 ||
    hashFacebookValue(input.state) !== session.id || session.phase !== "authorizing"
  ) {
    throw new FacebookConnectionFlowError("invalid");
  }
  if (!await context.store.transitionSession(session.id, "authorizing", "exchanging")) {
    throw new FacebookConnectionFlowError("invalid");
  }
  try {
    if (input.denied) {
      throw new FacebookConnectionFlowError("cancelled");
    }
    if (!input.code || input.code.length > 8192) {
      throw new FacebookConnectionFlowError("invalid");
    }
    const token = await exchangeFacebookCode(context.config, input.code);
    const authorization = await getFacebookAuthorization(context.config, token.accessToken);
    const userHash = facebookUserHash(context.config, authorization.userId);
    if (session.expiresAt <= context.now()) {
      throw new FacebookConnectionFlowError("expired");
    }
    await requireUnrevokedSession(context, session, userHash);
    const saved = await context.store.transitionSession(session.id, "exchanging", "selecting", {
      userHash,
      userTokenCipher: sealFacebookUserToken(context.config, session.id, token.accessToken),
      pages: authorization.pages.map((page) => {
        return { id: page.id, name: page.name };
      }),
    });
    if (!saved) {
      throw new FacebookConnectionFlowError("invalid");
    }
    await requireUnrevokedSession(context, session, userHash);
  } catch (error) {
    await failSession(context, session.id);
    throw error;
  }
}

export async function selectFacebookPage(
  context: FacebookConnectionContext,
  cookieValue: string | undefined,
  input: { pageId: string; csrf: string },
): Promise<void> {
  const session = await requireSession(context, cookieValue);
  if (
    !cookieValue || !validateFacebookCsrf(context.config, cookieValue, input.csrf) ||
    session.phase !== "selecting" || !session.userTokenCipher || !session.userHash ||
    !session.pages.some((page) => {
      return page.id === input.pageId;
    })
  ) {
    throw new FacebookConnectionFlowError("invalid");
  }
  if (!await context.store.transitionSession(session.id, "selecting", "saving", {
    connectionId: session.id,
    pageName: session.pages.find((page) => page.id === input.pageId)?.name ?? null,
  })) {
    throw new FacebookConnectionFlowError("invalid");
  }

  let connection: FacebookConnectionRecord | undefined;
  let cleanupPending = false;
  let failure: { error: unknown } | undefined;
  try {
    const userToken = openFacebookUserToken(context.config, session.id, session.userTokenCipher);
    await context.store.setSessionCleanupIntent(session.id, true);
    const page = await getFacebookPageAccess(context.config, userToken, input.pageId);
    if (session.expiresAt <= context.now()) {
      throw new FacebookConnectionFlowError("expired");
    }
    await requireUnrevokedSession(context, session, session.userHash);
    cleanupPending = true;
    const secretVersion = await context.secrets.save({
      connectionId: session.id,
      pageId: page.pageId,
      accessToken: page.accessToken,
      userHash: session.userHash,
      connectedAt: context.now(),
    });
    connection = {
      id: session.id,
      pageId: page.pageId,
      pageName: page.pageName,
      userHash: session.userHash,
      secretVersion,
      createdAt: context.now(),
      status: "pending_review",
      collectionEnabled: false,
    };
    await requireUnrevokedSession(context, session, session.userHash);
    await context.store.createConnection(session.id, connection);
    await requireUnrevokedSession(context, session, session.userHash);
    const saved = await context.store.transitionSession(session.id, "saving", "complete", {
      userTokenCipher: null,
      pages: [],
      pageName: page.pageName,
      connectionId: session.id,
    });
    if (!saved) {
      throw new FacebookConnectionFlowError("invalid");
    }
    cleanupPending = false;
  } catch (error) {
    failure = { error };
    try {
      if (connection) {
        await retireConnection(context, connection);
        cleanupPending = false;
      }
    } catch {
      cleanupPending = true;
    }
    try {
      await failSession(context, session.id, cleanupPending);
    } catch {
      cleanupPending = true;
    }
  }
  const settled = await settleSelection(context, session.id, cleanupPending);
  if (failure) {
    throw failure.error;
  }
  if (!settled) {
    throw new FacebookConnectionFlowError("storage");
  }
}

const errorCodes: FacebookConnectionErrorCode[] = [
  "cancelled", "expired", "permissions", "provider", "storage", "invalid",
  "rate_limit", "too_many_pages",
];

export async function getFacebookConnectionView(
  cookieValue: string | undefined,
  errorCode?: string,
): Promise<FacebookConnectionView> {
  const knownError = errorCodes.find((code) => code === errorCode);
  if (knownError) {
    return { status: "error", code: knownError };
  }
  if (!getFacebookConnectConfig()) {
    return { status: "intro", ready: false };
  }
  if (!cookieValue) {
    return { status: "intro", ready: true };
  }
  try {
    const context = await getFacebookConnectionContext();
    const session = await requireSession(context, cookieValue);
    if (session.phase === "selecting") {
      return {
        status: "select",
        pages: session.pages,
        csrfToken: facebookCsrfToken(context.config, cookieValue),
      };
    }
    if (session.phase === "complete" && session.pageName) {
      return { status: "connected", pageName: session.pageName };
    }
    return { status: "intro", ready: true };
  } catch (error) {
    return { status: "error", code: facebookFlowErrorCode(error) };
  }
}

export async function deleteFacebookUserConnections(
  context: FacebookConnectionContext,
  userId: string,
): Promise<string> {
  const userHash = facebookUserHash(context.config, userId);
  await context.store.recordUserRevocation(userHash, context.now());
  if (await context.store.hasSavingSessionForUser(userHash)) {
    throw new FacebookConnectionFlowError("storage");
  }
  const connections = await context.store.getConnectionsForUser(userHash);
  const connectionIds = new Set(connections.map((connection) => connection.id));
  const cleanupIntents = await context.store.getCleanupIntentIdsForUser(userHash);
  if (cleanupIntents.some((id) => !connectionIds.has(id))) {
    throw new FacebookConnectionFlowError("storage");
  }
  let cleanupFailed = false;
  for (const connection of connections) {
    try {
      await retireConnection(context, connection);
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    throw new FacebookConnectionFlowError("storage");
  }
  await context.store.deleteSessionsForUser(userHash);
  const confirmationCode = randomBytes(24).toString("base64url");
  await context.store.createDeletionReceipt(confirmationCode, { completedAt: context.now() });
  return confirmationCode;
}
