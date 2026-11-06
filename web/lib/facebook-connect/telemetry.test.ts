import type { Event, spanToJSON } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubFacebookBreadcrumb, scrubFacebookEvent, scrubFacebookSpan } from "./telemetry";

const providerUrl = "https://graph.facebook.com/v25.0/oauth/access_token?client_secret=synthetic-private-secret&code=synthetic-code";
type SpanJSON = ReturnType<typeof spanToJSON>;

function span(description: string): SpanJSON {
  return { trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 1, description, data: {} };
}

describe("Facebook connection telemetry boundaries", () => {
  it.each(["/api/integrations/facebook/callback?code=private&state=private", "/connect/facebook?invite=private"])(
    "excludes OAuth events together with their request bodies, headers, and cookies: %s",
    (path) => {
      const event: Event = { request: { url: `https://obo.example${path}`, data: "private-body", cookies: { session: "private-cookie" }, headers: { Authorization: "private-header" } } };
      expect(scrubFacebookEvent(event)).toBeNull();
    },
  );

  it("excludes provider errors even outside an OAuth route", () => {
    expect(scrubFacebookEvent({ exception: { values: [{ value: `Request failed: ${providerUrl}` }] } })).toBeNull();
  });

  it("removes provider breadcrumbs and browser navigation state", () => {
    expect(scrubFacebookBreadcrumb({ category: "http", data: { url: providerUrl, response: { access_token: "private" } } })).toBeNull();
    expect(scrubFacebookBreadcrumb({ category: "navigation", data: { to: "https://www.facebook.com/v25.0/dialog/oauth?state=private" } })).toBeNull();
  });

  it("replaces credential-bearing spans with fixed operation metadata", () => {
    const original = { ...span(`GET ${providerUrl}`), data: { "http.url": providerUrl, Authorization: "Bearer private" } };
    const scrubbed = scrubFacebookSpan(original);
    expect(scrubbed.description).toBe("Facebook authorization request");
    expect(scrubbed.trace_id).toBe(original.trace_id);
    expect(scrubbed.data).toEqual({});
    expect(JSON.stringify(scrubbed)).not.toContain("private");
  });

  it("preserves unrelated errors while sanitizing attached provider breadcrumbs and spans", () => {
    const ordinary = { category: "ui.click", message: "Open map" };
    const event: Event = {
      message: "Unrelated map error", request: { url: "https://obo.example/map" },
      breadcrumbs: [ordinary, { data: { url: providerUrl } }], spans: [span(providerUrl)],
    };
    const result = scrubFacebookEvent(event);
    expect(result?.message).toBe("Unrelated map error");
    expect(result?.breadcrumbs).toEqual([ordinary]);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-secret");
  });

  it("returns ordinary breadcrumbs and spans unchanged", () => {
    const breadcrumb = { category: "ui.click", message: "Open map" };
    const ordinary = span("GET /api/messages");
    expect(scrubFacebookBreadcrumb(breadcrumb)).toBe(breadcrumb);
    expect(scrubFacebookSpan(ordinary)).toBe(ordinary);
  });

  it("removes the connection session cookie from unrelated requests during an active flow", () => {
    const event: Event = {
      message: "Map error",
      request: {
        url: "https://obo.example/map",
        cookies: { "obo-facebook-connect": "private-browser-binding", ordinary: "preserved" },
        headers: { Cookie: "obo-facebook-connect=private-browser-binding; ordinary=preserved" },
      },
    };
    const result = scrubFacebookEvent(event);
    expect(result?.message).toBe("Map error");
    expect(result?.request?.cookies).toEqual({ ordinary: "preserved" });
    expect(JSON.stringify(result)).not.toContain("private-browser-binding");
  });
});
