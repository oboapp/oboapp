import type { MiddlewareHandler } from "hono";

const SUNSET_DATE = "Tue, 14 Oct 2026 00:00:00 GMT";
const SUCCESSOR_URL = "https://api.oboapp.online/v2/messages";

/**
 * Adds standard HTTP deprecation headers to v1 responses.
 *
 * Deprecation: true          — signals the endpoint is deprecated
 * Sunset: <date>             — when it will be removed
 * Link: <url>; rel="successor-version"  — points to the v2 equivalent
 */
export const v1DeprecationHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Deprecation", "true");
  c.header("Sunset", SUNSET_DATE);
  c.header("Link", `<${SUCCESSOR_URL}>; rel="successor-version"`);
};
