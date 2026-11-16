import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  facebookCsrfToken, facebookUserHash, hashFacebookValue, hashFacebookNetworkIdentifier, makeFacebookSession,
  matchesFacebookBrowser, openFacebookUserToken, parseFacebookSessionCookie,
  sealFacebookUserToken, validateFacebookCsrf, verifyFacebookSignedRequest,
} from "./crypto";

const config = {
  appId: "12345", appSecret: "synthetic-app-secret-at-least-32-chars", apiVersion: "v25.0",
  origin: "https://obo.example", redirectUri: "https://obo.example/api/integrations/facebook/callback",
  secretName: "projects/example/secrets/facebook-pages",
};
const token = "synthetic-private-user-token";

function signed(payload: unknown, secret = config.appSecret): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Facebook connection session protection", () => {
  it("generates independent browser bindings and opaque state-derived session identifiers", () => {
    const first = makeFacebookSession();
    const second = makeFacebookSession();
    expect(first.sessionId).toBe(hashFacebookValue(first.state));
    expect(first.state).not.toBe(first.browserSecret);
    expect(first.cookieValue).not.toContain(first.state);
    expect(first.cookieValue).not.toBe(second.cookieValue);
    expect(parseFacebookSessionCookie(first.cookieValue)).toEqual({ id: first.sessionId, browserSecret: first.browserSecret });
    expect(matchesFacebookBrowser(hashFacebookValue(first.browserSecret), first.browserSecret)).toBe(true);
    expect(matchesFacebookBrowser(hashFacebookValue(first.browserSecret), second.browserSecret)).toBe(false);
  });

  it.each(["", "x.y", "a".repeat(64), `${"a".repeat(64)}.${"b".repeat(43)}.extra`])("rejects malformed cookies: %s", (value) => {
    expect(parseFacebookSessionCookie(value)).toBeNull();
    expect(matchesFacebookBrowser("invalid", value)).toBe(false);
  });

  it("binds selection CSRF tokens to both the browser cookie and this app", () => {
    const first = makeFacebookSession();
    const second = makeFacebookSession();
    const csrf = facebookCsrfToken(config, first.cookieValue);
    expect(validateFacebookCsrf(config, first.cookieValue, csrf)).toBe(true);
    expect(validateFacebookCsrf(config, second.cookieValue, csrf)).toBe(false);
    expect(validateFacebookCsrf({ ...config, appId: "999" }, first.cookieValue, csrf)).toBe(false);
    expect(validateFacebookCsrf(config, first.cookieValue, `${csrf}x`)).toBe(false);
  });

  it("encrypts intermediate tokens with unique nonces and authenticates the session and app", () => {
    const session = makeFacebookSession();
    const sealed = sealFacebookUserToken(config, session.sessionId, token);
    expect(sealed).not.toContain(token);
    expect(sealFacebookUserToken(config, session.sessionId, token)).not.toBe(sealed);
    expect(openFacebookUserToken(config, session.sessionId, sealed)).toBe(token);
    for (const [otherConfig, otherSession] of [
      [config, makeFacebookSession().sessionId],
      [{ ...config, appSecret: "different-synthetic-secret-value" }, session.sessionId],
      [{ ...config, appId: "999" }, session.sessionId],
    ] as const) {
      expect(() => openFacebookUserToken(otherConfig, otherSession, sealed)).toThrow("Facebook connection session could not be read.");
    }
  });

  it("rejects tampered ciphertext with a static error and no credential details", () => {
    const session = makeFacebookSession();
    const parts = sealFacebookUserToken(config, session.sessionId, token).split(".");
    parts[2] = `${parts[2].startsWith("A") ? "B" : "A"}${parts[2].slice(1)}`;
    expect(() => openFacebookUserToken(config, session.sessionId, parts.join("."))).toThrow("Facebook connection session could not be read.");
    expect(() => openFacebookUserToken(config, session.sessionId, token)).not.toThrow(token);
  });

  it("uses app-specific irreversible user identifiers distinct from CSRF signatures", () => {
    const first = facebookUserHash(config, "555");
    expect(first).toBe(facebookUserHash(config, "555"));
    expect(first).not.toContain("555");
    expect(facebookUserHash({ ...config, appId: "999" }, "555")).not.toBe(first);
  });

  it("hashes network identifiers separately from provider user identities", () => {
    expect(hashFacebookNetworkIdentifier(config, "2001:db8::1")).toBe(hashFacebookNetworkIdentifier(config, "2001:db8::1"));
    expect(hashFacebookNetworkIdentifier(config, "555")).not.toBe(facebookUserHash(config, "555"));
    expect(() => hashFacebookNetworkIdentifier(config, "x".repeat(129))).toThrow("Invalid Facebook connection network identity.");
  });

  it("verifies Meta-signed requests and rejects forgery, wrong algorithms, and stale timestamps", () => {
    const payload = { algorithm: "HMAC-SHA256", user_id: "555", issued_at: Math.floor(Date.now() / 1000) };
    expect(verifyFacebookSignedRequest(config, signed(payload))).toEqual({ userId: "555" });
    expect(verifyFacebookSignedRequest(config, signed(payload, "attacker-key"))).toBeNull();
    expect(verifyFacebookSignedRequest(config, signed({ ...payload, algorithm: "none" }))).toBeNull();
    expect(verifyFacebookSignedRequest(config, signed({ ...payload, issued_at: payload.issued_at - 901 }))).toBeNull();
    expect(verifyFacebookSignedRequest(config, signed({ ...payload, issued_at: payload.issued_at + 61 }))).toBeNull();
    expect(verifyFacebookSignedRequest(config, signed({ ...payload, user_id: "invalid" }))).toBeNull();
    expect(verifyFacebookSignedRequest(config, "x".repeat(16385))).toBeNull();
  });
});
