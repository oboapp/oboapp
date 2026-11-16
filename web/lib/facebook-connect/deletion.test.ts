// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFacebookDeletion } from "./deletion";

const mocks = vi.hoisted(() => ({ getContext: vi.fn(), deleteUser: vi.fn() }));
vi.mock("./service", () => ({
  getFacebookConnectionContext: mocks.getContext,
  deleteFacebookUserConnections: mocks.deleteUser,
  FacebookConnectionFlowError: class extends Error {
    constructor(readonly code: string) {
      super("Controlled connection failure");
    }
  },
  facebookFlowErrorCode: () => "storage",
}));

const config = {
  appId: "12345", appSecret: "synthetic-app-secret-at-least-32-chars", apiVersion: "v25.0",
  origin: "https://obo.example", redirectUri: "https://obo.example/api/integrations/facebook/callback",
  secretName: "projects/example/secrets/facebook-pages",
};
const context = { config };

function signed(overrides: Record<string, unknown> = {}, secret = config.appSecret): string {
  const encoded = Buffer.from(JSON.stringify({
    algorithm: "HMAC-SHA256", user_id: "555", issued_at: Math.floor(Date.now() / 1000), ...overrides,
  })).toString("base64url");
  return `${createHmac("sha256", secret).update(encoded).digest("base64url")}.${encoded}`;
}

function request(signedRequest: string): Request {
  return new Request("https://obo.example/api/integrations/facebook/deletion", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: signedRequest }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
  mocks.getContext.mockReset().mockResolvedValue(context);
  mocks.deleteUser.mockReset().mockResolvedValue("synthetic-confirmation-code");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Facebook deletion callback", () => {
  it("verifies Meta's signature before deleting exactly the identified user's connections", async () => {
    const response = await handleFacebookDeletion(request(signed()));
    expect(response.status).toBe(200);
    expect(mocks.deleteUser).toHaveBeenCalledExactlyOnceWith(context, "555");
    expect(await response.json()).toEqual({
      confirmation_code: "synthetic-confirmation-code",
      url: "https://obo.example/connect/facebook/deletion?code=synthetic-confirmation-code",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["missing", "forged", "algorithm", "stale", "identity"])("rejects %s signed requests before any deletion", async (kind) => {
    let value = "";
    if (kind === "forged") {
      value = signed({}, "attacker-secret");
    } else if (kind === "algorithm") {
      value = signed({ algorithm: "none" });
    } else if (kind === "stale") {
      value = signed({ issued_at: Math.floor(Date.now() / 1000) - 901 });
    } else if (kind === "identity") {
      value = signed({ user_id: "invalid-user" });
    }
    const response = await handleFacebookDeletion(request(value));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("classifies malformed form input as a bad request without deleting anything", async () => {
    const response = await handleFacebookDeletion(new Request("https://obo.example/api/integrations/facebook/deletion", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signed_request: signed() }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("returns a retryable controlled response when credential cleanup fails", async () => {
    mocks.deleteUser.mockRejectedValueOnce(new Error("synthetic-private-page-token"));
    const response = await handleFacebookDeletion(request(signed()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps setup and backend failure details out of callback responses", async () => {
    mocks.getContext.mockRejectedValueOnce(new Error(config.appSecret));
    const response = await handleFacebookDeletion(request(signed()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(config.appSecret);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
