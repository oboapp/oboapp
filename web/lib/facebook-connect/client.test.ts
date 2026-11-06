import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFacebookAuthorizationUrl,
  exchangeFacebookCode,
  FacebookAuthorizationError,
  getFacebookAuthorization,
  getFacebookPageAccess,
} from "./client";

const config = {
  appId: "12345",
  appSecret: "synthetic-app-secret-never-share",
  apiVersion: "v25.0",
  origin: "https://obo.example",
  redirectUri: "https://obo.example/api/integrations/facebook/callback",
  secretName: "projects/example/secrets/facebook-pages",
};
const userToken = "synthetic-user-token";
const pageToken = "synthetic-page-token";
const permissions = { data: [
  { permission: "pages_show_list", status: "granted" },
  { permission: "pages_read_engagement", status: "granted" },
] };
const page = { id: "101", name: "Район Оборище", tasks: ["ANALYZE"] };
let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

function respond(...bodies: unknown[]): void {
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  }
}

beforeEach(() => {
  fetchMock = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Facebook connection provider", () => {
  it("builds a code-flow login URL without placing app credentials in the browser", () => {
    const url = new URL(buildFacebookAuthorizationUrl(config, "s".repeat(43)));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("pages_show_list,pages_read_engagement");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.toString()).not.toContain(config.appSecret);
    expect(url.searchParams.has("config_id")).toBe(false);
  });

  it("uses the configured business login flow without adding scope or unverified PKCE parameters", () => {
    const url = new URL(buildFacebookAuthorizationUrl({ ...config, loginConfigId: "987" }, "s".repeat(43)));
    expect(url.searchParams.get("config_id")).toBe("987");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });

  it("exchanges the code once and records the long-lived User grant expiry in milliseconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    respond({ access_token: "synthetic-short-token" }, { access_token: userToken, expires_in: 3600 });
    await expect(exchangeFacebookCode(config, "synthetic-authorization-code")).resolves.toEqual({
      accessToken: userToken,
      expiresAt: Date.now() + 3600000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(firstUrl.pathname).toBe("/v25.0/oauth/access_token");
    expect(firstUrl.searchParams.get("code")).toBe("synthetic-authorization-code");
    expect(secondUrl.searchParams.get("grant_type")).toBe("fb_exchange_token");
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      expect(init?.signal).toBeDefined();
    }
  });

  it("does not infer a Page-token lifetime from an absent User expiry", async () => {
    respond({ access_token: "synthetic-short-token" }, { access_token: userToken });
    expect((await exchangeFacebookCode(config, "synthetic-code")).expiresAt).toBeNull();
  });

  it("enumerates managed Pages by fixed-endpoint cursor pagination without leaking the User token", async () => {
    respond(permissions, { id: "555" }, {
      data: [page],
      paging: { next: "https://attacker.example/private?access_token=synthetic-secret", cursors: { after: "next" } },
    }, { data: [{ id: "202", name: "Район Студентски" }], paging: { cursors: { after: "terminal" } } });
    await expect(getFacebookAuthorization(config, userToken)).resolves.toEqual({
      userId: "555",
      pages: [page, { id: "202", name: "Район Студентски", tasks: [] }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://graph.facebook.com");
      expect(url.toString()).not.toContain(userToken);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${userToken}`);
    }
    const finalUrl = new URL(String(fetchMock.mock.calls[3][0]));
    expect(finalUrl.pathname).toBe("/v25.0/me/accounts");
    expect(finalUrl.searchParams.get("after")).toBe("next");
    expect(finalUrl.searchParams.get("fields")).toBe("id,name,tasks");
  });

  it("rejects declined read permissions before enumerating any Pages", async () => {
    respond({ data: [{ permission: "pages_show_list", status: "granted" }] });
    await expect(getFacebookAuthorization(config, userToken)).rejects.toMatchObject({ code: "permissions" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed User identity before listing Pages", async () => {
    respond(permissions, { id: "invalid-user" });
    await expect(getFacebookAuthorization(config, userToken)).rejects.toMatchObject({ code: "provider" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...page, id: "101/../../me" },
    { ...page, name: "x".repeat(501) },
    { ...page, tasks: [42] },
  ])("rejects invalid Page records before returning authorization: %j", async (invalidPage) => {
    respond(permissions, { id: "555" }, { data: [invalidPage] });
    await expect(getFacebookAuthorization(config, userToken)).rejects.toMatchObject({ code: "provider" });
  });

  it.each([undefined, "repeated"])("rejects missing or looping provider cursors: %s", async (cursor) => {
    const paging = { next: "present", cursors: { after: cursor } };
    respond(permissions, { id: "555" }, { data: [page], paging }, { data: [page], paging });
    await expect(getFacebookAuthorization(config, userToken)).rejects.toMatchObject({ code: "provider" });
    expect(fetchMock.mock.calls).toHaveLength(cursor === undefined ? 3 : 4);
  });

  it("fails instead of silently truncating more than five hundred authorized Pages", async () => {
    respond(permissions, { id: "555" });
    for (let index = 0; index < 6; index++) {
      respond({ data: Array.from({ length: 100 }, (_, item) => ({
        id: String(index * 100 + item + 1), name: `Район ${item}`,
      })), paging: { next: "present", cursors: { after: `cursor-${index}` } } });
    }
    await expect(getFacebookAuthorization(config, userToken)).rejects.toMatchObject({ code: "too_many_pages" });
  });

  it("obtains and verifies only the selected Page token through authorization headers", async () => {
    respond({ ...page, access_token: pageToken }, { data: [{ id: "101_999" }] });
    await expect(getFacebookPageAccess(config, userToken, "101")).resolves.toEqual({
      pageId: "101", pageName: page.name, accessToken: pageToken,
    });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${userToken}`);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe(`Bearer ${pageToken}`);
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe("/v25.0/101/published_posts");
  });

  it("rejects a different Page returned for the selected identifier", async () => {
    respond({ ...page, id: "202", access_token: pageToken });
    await expect(getFacebookPageAccess(config, userToken, "101")).rejects.toBeInstanceOf(FacebookAuthorizationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires a successful published-post read before accepting the selected Page token", async () => {
    respond({ ...page, access_token: pageToken }, { data: "invalid", private: pageToken });
    await expect(getFacebookPageAccess(config, userToken, "101")).rejects.toMatchObject({ code: "provider" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "json", "graph", "token"])("keeps raw %s failures out of errors and never retries code exchange", async (kind) => {
    if (kind === "network") {
      fetchMock.mockRejectedValueOnce(new Error(`https://graph.facebook.com/?client_secret=${config.appSecret}`));
    } else if (kind === "json") {
      fetchMock.mockResolvedValueOnce(new Response(`invalid JSON ${config.appSecret}`));
    } else if (kind === "graph") {
      respond({ error: { message: config.appSecret, code: 190 } });
    } else {
      respond({ access_token: `${userToken} invalid` });
    }
    try {
      await exchangeFacebookCode(config, "synthetic-code");
      expect.fail("Expected a controlled authorization error");
    } catch (error) {
      expect(error).toBeInstanceOf(FacebookAuthorizationError);
      expect(String(error)).not.toContain(config.appSecret);
      expect(JSON.stringify(error)).not.toContain(config.appSecret);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
