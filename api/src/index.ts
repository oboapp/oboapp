import { Hono } from "hono";
import { sourcesRoute } from "./routes/sources";
import { messagesRoute } from "./routes/messages";
import { messageByIdRoute } from "./routes/messages-by-id";
import { openapiRoute } from "./routes/openapi";

const app = new Hono();

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Public API routes (v1)
app.route("/v1", sourcesRoute);
app.route("/v1", messagesRoute);
app.route("/v1", messageByIdRoute);
app.route("/v1", openapiRoute);

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;
export { app };
