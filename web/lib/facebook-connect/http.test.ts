// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACEBOOK_SESSION_COOKIE } from "./config";
import { facebookRedirect, readFacebookForm, requireFacebookSameOrigin } from "./http";

vi.mock("./service", () => ({
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

function formRequest(body = "consent=yes", headers: Record<string, string> = {}): Request {
  return new Request("https://obo.example/api/integrations/facebook/start", {
    method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv("FACEBOOK_APP_ID", config.appId);
  vi.stubEnv("FACEBOOK_APP_SECRET", config.appSecret);
  vi.stubEnv("FACEBOOK_GRAPH_API_VERSION", config.apiVersion);
  vi.stubEnv("FACEBOOK_PAGE_TOKENS_SECRET", config.secretName);
  vi.stubEnv("FACEBOOK_CONNECT_BASE_URL", config.origin);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Facebook connection HTTP boundaries", () => {
  it("accepts only an exact configured Origin for browser mutations", () => {
    expect(() => requireFacebookSameOrigin(formRequest("consent=yes", { Origin: config.origin }), config)).not.toThrow();
    for (const origin of ["", "null", "http://obo.example", "https://obo.example:444", "https://obo.example.attacker.invalid", "https://obo.example/"]) {
      expect(() => requireFacebookSameOrigin(formRequest("consent=yes", { Origin: origin }), config)).toThrow();
    }
    expect(() => requireFacebookSameOrigin(formRequest(), config)).toThrow();
  });

  it("redirects callbacks to the configured origin with status303 and no code or state", () => {
    const request = new Request("https://untrusted-host.example/api/integrations/facebook/callback?code=synthetic-private-code&state=synthetic-state");
    const response = facebookRedirect(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://obo.example/connect/facebook");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(JSON.stringify([...response.headers])).not.toContain("synthetic-private-code");
  });

  it("sets an opaque HttpOnly Secure Lax cookie for the HTTPS connection", () => {
    const response = facebookRedirect(formRequest(), {
      location: "https://www.facebook.com/v25.0/dialog/oauth?state=synthetic-state",
      cookieValue: "opaque-session.browser-binding",
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${FACEBOOK_SESSION_COOKIE}=opaque-session.browser-binding`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=900");
  });

  it("clears the cookie and shares only a controlled error code after failure", () => {
    const response = facebookRedirect(formRequest(), { error: new Error("synthetic-secret-never-share"), clearCookie: true });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://obo.example/connect/facebook?error=storage");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(JSON.stringify([...response.headers])).not.toContain("synthetic-secret-never-share");
  });

  it("decodes bounded form data while preserving Bulgarian values", async () => {
    const value = new URLSearchParams({ pageId: "101", note: "Район Оборище" });
    const parsed = await readFacebookForm(formRequest(value.toString()));
    expect(parsed.get("pageId")).toBe("101");
    expect(parsed.get("note")).toBe("Район Оборище");
  });

  it.each(["application/json", "text/plain", "application/x-www-form-urlencoded-evil"])(
    "rejects content types outside the form media type: %s", async (contentType) => {
      await expect(readFacebookForm(formRequest("consent=yes", { "Content-Type": contentType }))).rejects.toMatchObject({ code: "invalid" });
    },
  );

  it.each(["-1", "1.5", "not-a-size", "16385"])("rejects invalid declared byte sizes before reading: %s", async (length) => {
    const request = formRequest("consent=yes", { "Content-Length": length });
    const body = request.body;
    expect(body).not.toBeNull();
    if (!body) {
      throw new Error("Expected a request body");
    }
    const read = vi.spyOn(body, "getReader");
    await expect(readFacebookForm(request)).rejects.toMatchObject({ code: "invalid" });
    expect(read).not.toHaveBeenCalled();
  });

  it("enforces the form limit in UTF8 bytes instead of JavaScript string length", async () => {
    await expect(readFacebookForm(formRequest(`message=${"Ж".repeat(9000)}`))).rejects.toMatchObject({ code: "invalid" });
  });

  it("stops and cancels an oversized stream before buffering the entire body", async () => {
    let chunksRead = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead++;
        controller.enqueue(new Uint8Array(1024).fill(97));
        if (chunksRead === 100) {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    const options: RequestInit & { duplex: "half" } = {
      method: "POST", body: stream, duplex: "half",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    };
    const request = new Request("https://obo.example/api/integrations/facebook/select", options);
    await expect(readFacebookForm(request)).rejects.toMatchObject({ code: "invalid" });
    expect(cancelled).toBe(true);
    expect(chunksRead).toBeLessThan(100);
  });
});
