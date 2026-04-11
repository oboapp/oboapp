import * as Sentry from "@sentry/node";

/**
 * Initialize Sentry error monitoring for the public API.
 *
 * No-ops when SENTRY_DSN is not set, so self-hosters without a Sentry
 * account get identical behaviour — errors still appear in Vercel logs.
 *
 * Called at module load time in index.ts (env vars are available
 * immediately on Vercel without dotenv).
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}

export function captureException(err: unknown): void {
  Sentry.captureException(err);
}
