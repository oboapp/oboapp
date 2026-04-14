import { Hono } from "hono";
import { sourcesRoute } from "./routes/sources";
import { messagesRoute } from "./routes/messages";
import { messageByIdRoute } from "./routes/messages-by-id";
import { openapiRoute } from "./routes/openapi";
import { sourcesRouteV2 } from "./routes/v2/sources";
import { messagesRouteV2 } from "./routes/v2/messages";
import { messageByIdRouteV2 } from "./routes/v2/messages-by-id";
import { openapiRouteV2 } from "./routes/v2/openapi";
import { initSentry, captureException } from "./lib/sentry";

initSentry();

const app = new Hono();

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Public API routes (v1 — deprecated, sunset Oct 14 2026)
app.route("/v1", sourcesRoute);
app.route("/v1", messagesRoute);
app.route("/v1", messageByIdRoute);
app.route("/v1", openapiRoute);

// Public API routes (v2)
app.route("/v2", sourcesRouteV2);
app.route("/v2", messagesRouteV2);
app.route("/v2", messageByIdRouteV2);
app.route("/v2", openapiRouteV2);

// Global error handler
app.onError((err, c) => {
  captureException(err);
  console.warn("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;
export { app };
