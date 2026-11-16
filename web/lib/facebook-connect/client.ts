import type { FacebookConnectConfig } from "./config";

export interface FacebookPage {
  id: string;
  name: string;
  tasks: string[];
}

type AuthorizationCode = "provider" | "permissions" | "cancelled" | "too_many_pages";
const messages: Record<AuthorizationCode, string> = {
  provider: "Facebook authorization could not be verified.",
  permissions: "Facebook Page read permissions were not granted.",
  cancelled: "Facebook authorization was cancelled.",
  too_many_pages: "Facebook returned too many Pages. Select fewer Pages and reconnect.",
};

export class FacebookAuthorizationError extends Error {
  constructor(readonly code: AuthorizationCode) {
    super(messages[code]);
    this.name = "FacebookAuthorizationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,31}$/.test(value);
}

function token(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 8192 && !/\s/.test(value);
}

function graphUrl(config: FacebookConnectConfig, path: string): URL {
  return new URL(`https://graph.facebook.com/${config.apiVersion}/${path}`);
}

async function request(url: URL, accessToken?: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const body: unknown = await response.json();
    if (!response.ok || !record(body) || "error" in body) {
      throw new FacebookAuthorizationError("provider");
    }
    return body;
  } catch {
    throw new FacebookAuthorizationError("provider");
  }
}

export function buildFacebookAuthorizationUrl(config: FacebookConnectConfig, state: string): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(state)) {
    throw new FacebookAuthorizationError("provider");
  }
  const url = new URL(`https://www.facebook.com/${config.apiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (config.loginConfigId) {
    url.searchParams.set("config_id", config.loginConfigId);
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", "pages_show_list,pages_read_engagement");
  }
  return url.toString();
}

/** Exchanges remain server-side; telemetry removes provider query strings. */
export async function exchangeFacebookCode(
  config: FacebookConnectConfig,
  code: string,
): Promise<{ accessToken: string; expiresAt: number | null }> {
  if (!token(code)) {
    throw new FacebookAuthorizationError("provider");
  }
  const exchange = graphUrl(config, "oauth/access_token");
  exchange.searchParams.set("client_id", config.appId);
  exchange.searchParams.set("client_secret", config.appSecret);
  exchange.searchParams.set("redirect_uri", config.redirectUri);
  exchange.searchParams.set("code", code);
  const initial = await request(exchange);
  if (!token(initial.access_token)) {
    throw new FacebookAuthorizationError("provider");
  }
  const extend = graphUrl(config, "oauth/access_token");
  extend.searchParams.set("client_id", config.appId);
  extend.searchParams.set("client_secret", config.appSecret);
  extend.searchParams.set("grant_type", "fb_exchange_token");
  extend.searchParams.set("fb_exchange_token", initial.access_token);
  const result = await request(extend);
  const seconds = result.expires_in ?? result.expires;
  if (!token(result.access_token) || (seconds !== undefined &&
      (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 315360000))) {
    throw new FacebookAuthorizationError("provider");
  }
  return {
    accessToken: result.access_token,
    expiresAt: typeof seconds === "number" && seconds > 0 ? Date.now() + seconds * 1000 : null,
  };
}

function readPage(value: unknown): FacebookPage {
  if (!record(value) || !identifier(value.id) || typeof value.name !== "string" ||
      !value.name.trim() || value.name.length > 500 ||
      (value.tasks !== undefined && (!Array.isArray(value.tasks) ||
        !value.tasks.every((task: unknown) => typeof task === "string" && task.length <= 100)))) {
    throw new FacebookAuthorizationError("provider");
  }
  const tasks: string[] = [];
  if (Array.isArray(value.tasks)) {
    for (const task of value.tasks) {
      if (typeof task === "string") {
        tasks.push(task);
      }
    }
  }
  return { id: value.id, name: value.name, tasks };
}

function nextPageCursor(paging: unknown, userToken: string, cursors: Set<string>): string | undefined {
  if (paging === undefined) {
    return undefined;
  }
  if (!record(paging)) {
    throw new FacebookAuthorizationError("provider");
  }
  if (paging.next === undefined || paging.next === "") {
    return undefined;
  }
  const after = record(paging.cursors) ? paging.cursors.after : undefined;
  if (typeof paging.next !== "string" || typeof after !== "string" || !after ||
      after.length > 8192 || after.includes(userToken) || cursors.has(after)) {
    throw new FacebookAuthorizationError("provider");
  }
  cursors.add(after);
  return after;
}

async function listAuthorizedPages(config: FacebookConnectConfig, userToken: string): Promise<FacebookPage[]> {
  const pages = new Map<string, FacebookPage>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let count = 0;
  for (let index = 0; index < 20; index++) {
    const url = graphUrl(config, "me/accounts");
    url.searchParams.set("fields", "id,name,tasks");
    url.searchParams.set("limit", "100");
    if (cursor !== undefined) {
      url.searchParams.set("after", cursor);
    }
    const result = await request(url, userToken);
    if (!Array.isArray(result.data) || result.data.length > 100) {
      throw new FacebookAuthorizationError("provider");
    }
    count += result.data.length;
    if (count > 500) {
      throw new FacebookAuthorizationError("too_many_pages");
    }
    for (const candidate of result.data) {
      const page = readPage(candidate);
      pages.set(page.id, page);
    }
    cursor = nextPageCursor(result.paging, userToken, cursors);
    if (cursor === undefined) {
      return [...pages.values()];
    }
  }
  throw new FacebookAuthorizationError("too_many_pages");
}

export async function getFacebookAuthorization(
  config: FacebookConnectConfig,
  userToken: string,
): Promise<{ userId: string; pages: FacebookPage[] }> {
  if (!token(userToken)) {
    throw new FacebookAuthorizationError("provider");
  }
  const permissions = await request(graphUrl(config, "me/permissions"), userToken);
  if (!Array.isArray(permissions.data)) {
    throw new FacebookAuthorizationError("provider");
  }
  const granted = new Set(permissions.data.filter(record).filter((entry) => {
    return entry.status === "granted";
  }).map((entry) => entry.permission));
  if (!granted.has("pages_show_list") || !granted.has("pages_read_engagement")) {
    throw new FacebookAuthorizationError("permissions");
  }
  const identityUrl = graphUrl(config, "me");
  identityUrl.searchParams.set("fields", "id");
  const identity = await request(identityUrl, userToken);
  if (!identifier(identity.id)) {
    throw new FacebookAuthorizationError("provider");
  }
  return { userId: identity.id, pages: await listAuthorizedPages(config, userToken) };
}

export async function getFacebookPageAccess(
  config: FacebookConnectConfig,
  userToken: string,
  pageId: string,
): Promise<{ pageId: string; pageName: string; accessToken: string }> {
  if (!token(userToken) || !identifier(pageId)) {
    throw new FacebookAuthorizationError("provider");
  }
  const pageUrl = graphUrl(config, pageId);
  pageUrl.searchParams.set("fields", "id,name,access_token");
  const result = await request(pageUrl, userToken);
  const page = readPage(result);
  if (page.id !== pageId || !token(result.access_token)) {
    throw new FacebookAuthorizationError("provider");
  }
  const probeUrl = graphUrl(config, `${pageId}/published_posts`);
  probeUrl.searchParams.set("fields", "id");
  probeUrl.searchParams.set("limit", "1");
  const probe = await request(probeUrl, result.access_token);
  if (!Array.isArray(probe.data) || probe.data.length > 1 ||
      !probe.data.every((post: unknown) => record(post) && typeof post.id === "string" &&
        /^\d+_\d+$/.test(post.id) && post.id.startsWith(`${pageId}_`))) {
    throw new FacebookAuthorizationError("provider");
  }
  return { pageId, pageName: page.name, accessToken: result.access_token };
}
