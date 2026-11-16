import * as Sentry from "@sentry/node";
import { setErrorReporter } from "@/lib/logger";
import {
  sanitizeDiagnosticText,
  sanitizeError,
  serializeError,
} from "@/lib/error-diagnostics";

/**
 * Flush pending Sentry events before process exit.
 * Cloud Run jobs exit immediately, so queued events must be flushed first.
 */
export async function flushSentry(): Promise<void> {
  await Sentry.flush(5000);
}

/**
 * Initialize Sentry error monitoring for the ingest pipeline.
 *
 * Errors continue to reach Cloud Logging when SENTRY_DSN is not set.
 *
 * Must be called after dotenv.config() so SENTRY_DSN is available.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
  });

  // Forward every logger.error() call to Sentry so structured error logs
  // appear in Sentry alongside automatically captured unhandled exceptions.
  setErrorReporter((message, extra) => {
    const safeMessage = sanitizeDiagnosticText(message);
    Sentry.withScope((scope) => {
      scope.setExtra("loggerMessage", safeMessage);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          if (key === "error" || value instanceof Error) {
            scope.setExtra(key, serializeError(value));
          } else if (typeof value === "string") {
            scope.setExtra(key, sanitizeDiagnosticText(value));
          } else {
            scope.setExtra(key, value);
          }
        }
      }
      // Preserve the exception chain and stack with sensitive URL parts removed.
      if (extra?.error instanceof Error) {
        Sentry.captureException(sanitizeError(extra.error));
      } else {
        Sentry.captureMessage(safeMessage, "error");
      }
    });
  });
}
