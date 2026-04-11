import * as Sentry from "@sentry/node";
import { setErrorReporter } from "@/lib/logger";

/**
 * Initialize Sentry error monitoring for the ingest pipeline.
 *
 * No-ops when SENTRY_DSN is not set, so self-hosters without a Sentry
 * account get identical behaviour to today — errors still go to Cloud Logging.
 *
 * Must be called after dotenv.config() so SENTRY_DSN is available.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
  });

  // Forward every logger.error() call to Sentry so structured error logs
  // appear in Sentry alongside automatically captured unhandled exceptions.
  setErrorReporter((message, extra) => {
    Sentry.captureMessage(message, { level: "error", extra });
  });
}
