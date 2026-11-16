import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { FacebookConnectConfig } from "./config";

const browserPattern = /^[A-Za-z0-9_-]{43}$/;
const sessionPattern = /^[a-f0-9]{64}$/;

function key(config: FacebookConnectConfig, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", config.appSecret, config.appId,
    `obo/facebook-connect/v1/${purpose}`, 32));
}

function signature(config: FacebookConnectConfig, purpose: string, value: string): string {
  return createHmac("sha256", key(config, purpose)).update(value).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function hashFacebookValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function makeFacebookSession(): {
  state: string;
  sessionId: string;
  browserSecret: string;
  cookieValue: string;
} {
  const state = randomBytes(32).toString("base64url");
  const sessionId = hashFacebookValue(state);
  const browserSecret = randomBytes(32).toString("base64url");
  return { state, sessionId, browserSecret, cookieValue: `${sessionId}.${browserSecret}` };
}

export function parseFacebookSessionCookie(value: string): { id: string; browserSecret: string } | null {
  const parts = value.split(".");
  if (parts.length !== 2 || !sessionPattern.test(parts[0]) || !browserPattern.test(parts[1])) {
    return null;
  }
  return { id: parts[0], browserSecret: parts[1] };
}

export function matchesFacebookBrowser(storedHash: string, browserSecret: string): boolean {
  return sessionPattern.test(storedHash) && browserPattern.test(browserSecret) &&
    equal(storedHash, hashFacebookValue(browserSecret));
}

export function facebookCsrfToken(config: FacebookConnectConfig, cookieValue: string): string {
  if (!parseFacebookSessionCookie(cookieValue)) {
    throw new Error("Invalid Facebook connection session.");
  }
  return signature(config, "csrf", cookieValue);
}

export function validateFacebookCsrf(config: FacebookConnectConfig, cookieValue: string, token: string): boolean {
  return parseFacebookSessionCookie(cookieValue) !== null && browserPattern.test(token) &&
    equal(signature(config, "csrf", cookieValue), token);
}

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid Facebook connection session.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Invalid Facebook connection session.");
  }
  return decoded;
}

function checkToken(token: string): void {
  if (!token || token.length > 8192 || /\s/.test(token)) {
    throw new Error("Invalid Facebook connection credentials.");
  }
}

export function sealFacebookUserToken(config: FacebookConnectConfig, sessionId: string, token: string): string {
  if (!sessionPattern.test(sessionId)) {
    throw new Error("Invalid Facebook connection session.");
  }
  checkToken(token);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(config, "user-token"), nonce);
  cipher.setAAD(Buffer.from(`${config.appId}:${sessionId}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openFacebookUserToken(config: FacebookConnectConfig, sessionId: string, sealed: string): string {
  try {
    const parts = sealed.split(".");
    if (!sessionPattern.test(sessionId) || sealed.length > 12000 || parts.length !== 4 || parts[0] !== "v1") {
      throw new Error("Invalid session");
    }
    const nonce = decode(parts[1]);
    const encrypted = decode(parts[2]);
    const tag = decode(parts[3]);
    if (nonce.length !== 12 || tag.length !== 16 || encrypted.length > 8192) {
      throw new Error("Invalid session");
    }
    const cipher = createDecipheriv("aes-256-gcm", key(config, "user-token"), nonce);
    cipher.setAAD(Buffer.from(`${config.appId}:${sessionId}`, "utf8"));
    cipher.setAuthTag(tag);
    const token = Buffer.concat([cipher.update(encrypted), cipher.final()]).toString("utf8");
    checkToken(token);
    return token;
  } catch {
    throw new Error("Facebook connection session could not be read.");
  }
}

export function facebookUserHash(config: FacebookConnectConfig, userId: string): string {
  if (!/^[1-9]\d{0,31}$/.test(userId)) {
    throw new Error("Invalid Facebook user identity.");
  }
  return signature(config, "user-identity", userId);
}

export function hashFacebookNetworkIdentifier(config: FacebookConnectConfig, value: string): string {
  if (!value || value.length > 128 || /[\r\n]/.test(value)) {
    throw new Error("Invalid Facebook connection network identity.");
  }
  return signature(config, "network-identity", value);
}

export function verifyFacebookSignedRequest(
  config: FacebookConnectConfig,
  signedRequest: string,
): { userId: string } | null {
  try {
    if (signedRequest.length > 16384) {
      return null;
    }
    const parts = signedRequest.split(".");
    if (parts.length !== 2) {
      return null;
    }
    const supplied = decode(parts[0]);
    const expected = createHmac("sha256", config.appSecret).update(parts[1]).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return null;
    }
    const payload: unknown = JSON.parse(decode(parts[1]).toString("utf8"));
    if (typeof payload !== "object" || payload === null || !("algorithm" in payload) ||
        payload.algorithm !== "HMAC-SHA256" || !("user_id" in payload) ||
        typeof payload.user_id !== "string" || !/^[1-9]\d{0,31}$/.test(payload.user_id) ||
        !("issued_at" in payload) || typeof payload.issued_at !== "number" || !Number.isSafeInteger(payload.issued_at)) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.issued_at < now - 900 || payload.issued_at > now + 60) {
      return null;
    }
    return { userId: payload.user_id };
  } catch {
    return null;
  }
}
