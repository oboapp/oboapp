import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures uncaught errors thrown in Server Components, route handlers, and
// server actions. Without this, App Router server-side errors never reach Sentry.
export const onRequestError = Sentry.captureRequestError;
