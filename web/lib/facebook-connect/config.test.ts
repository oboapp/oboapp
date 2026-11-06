import { describe, expect, it } from "vitest";
import { getFacebookConnectConfig } from "./config";

const env = {
  NODE_ENV: "test" as const,
  FACEBOOK_APP_ID: "123456",
  FACEBOOK_APP_SECRET: "a".repeat(32),
  FACEBOOK_GRAPH_API_VERSION: "v25.0",
  FACEBOOK_PAGE_TOKENS_SECRET: "projects/demo-project/secrets/facebook-pages",
  NEXT_PUBLIC_BASE_URL: "https://example.com",
};

describe("Facebook connection config", () => {
  it("derives the exact callback from a trusted origin", () => {
    expect(getFacebookConnectConfig(env)?.redirectUri).toBe("https://example.com/api/integrations/facebook/callback");
  });

  it.each(["https://example.com/a", "https://example.com/?x=1", "https://example.com/#x", "https://user:pass@example.com", "http://example.com"])("rejects unsafe base URL %s", (url) => {
    expect(getFacebookConnectConfig({ ...env, FACEBOOK_CONNECT_BASE_URL: url })).toBeUndefined();
  });

  it("requires server credentials and a fixed secret resource", () => {
    expect(getFacebookConnectConfig({ ...env, FACEBOOK_APP_SECRET: "" })).toBeUndefined();
    expect(getFacebookConnectConfig({ ...env, FACEBOOK_PAGE_TOKENS_SECRET: "projects/demo/secrets/pages/versions/latest" })).toBeUndefined();
  });

  it("supports local HTTP only outside production", () => {
    expect(getFacebookConnectConfig({ ...env, NEXT_PUBLIC_BASE_URL: "http://localhost:3000", NODE_ENV: "development" })).toBeDefined();
    expect(getFacebookConnectConfig({ ...env, NEXT_PUBLIC_BASE_URL: "http://localhost:3000", NODE_ENV: "production" })).toBeUndefined();
  });
});
