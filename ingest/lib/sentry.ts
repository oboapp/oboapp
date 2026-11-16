import * as Sentry from "@sentry/node";
import { getCloudRunContext, logger, setErrorReporter } from "@/lib/logger";
import {
  sanitizeDiagnosticText,
  sanitizeError,
  serializeError,
} from "@/lib/error-diagnostics";

interface SourceWarningMetadata extends Record<string, unknown> {
  sourceType: string;
  diagnosticCode: "rss-discovery-failure";
  error: unknown;
}

function setDiagnosticExtras(
  scope: Sentry.Scope,
  extra: Record<string, unknown>,
): void {
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

function setSourceWarningTags(
  scope: Sentry.Scope,
  extra: Record<string, unknown>,
): void {
  for (const key of ["sourceType", "diagnosticCode"]) {
    const value = extra[key];
    if (typeof value === "string") {
      scope.setTag(key, sanitizeDiagnosticText(value));
    }
  }
}

function captureDiagnostic(
  message: string,
  extra: Record<string, unknown> | undefined,
  level: "error" | "warning",
): void {
  const safeMessage = sanitizeDiagnosticText(message);
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setExtra("loggerMessage", safeMessage);
    if (extra) {
      setDiagnosticExtras(scope, extra);
      if (level === "warning") {
        setSourceWarningTags(scope, extra);
      }
    }
    // Preserve the exception chain and stack with sensitive URL parts removed.
    if (extra?.error instanceof Error) {
      Sentry.captureException(sanitizeError(extra.error));
    } else {
      Sentry.captureMessage(safeMessage, level);
    }
  });
}

/** Report a recoverable source issue with its scheduler context. */
export function reportSourceWarning(
  message: string,
  extra: SourceWarningMetadata,
): void {
  logger.warn(message, extra);
  try {
    if (Sentry.isInitialized()) {
      captureDiagnostic(message, { ...extra, ...getCloudRunContext() }, "warning");
    }
  } catch {
    // Keep source recovery running when telemetry is unavailable.
  }
}

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
    captureDiagnostic(message, extra, "error");
  });
}
