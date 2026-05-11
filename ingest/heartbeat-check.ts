#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { verifyDbEnv } from "@/lib/verify-env";
import { logger } from "@/lib/logger";
import { initSentry, flushSentry } from "@/lib/sentry";

const DEFAULT_WINDOW_HOURS = 24;

const program = new Command();

program
  .name("heartbeat-check")
  .description(
    "Verify that the notification pipeline produced at least one match recently",
  )
  .option(
    "--hours <number>",
    "Lookback window in hours (default: 24)",
    String(DEFAULT_WINDOW_HOURS),
  )
  .addHelpText(
    "after",
    `
This is a liveness probe for the end-to-end notification pipeline.
It counts documents in the notificationMatches collection whose
matchedAt timestamp falls within the lookback window. If zero matches
are found, it logs an ERROR (which trips the existing log-based alert)
and exits with code 1.

This catches silent failures the per-job error alerts miss, e.g.:
  - notify queue invisible due to schema drift
  - matching logic regression
  - FCM credential rotation that swallows errors
  - Firestore writes silently failing

Examples:
  $ pnpm heartbeat-check
  $ pnpm heartbeat-check --hours 48
`,
  )
  .action(async (opts: { hours: string }) => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    initSentry();
    verifyDbEnv();

    const hours = Number(opts.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      logger.error("Invalid --hours value", { value: opts.hours });
      await flushSentry();
      process.exit(2);
    }

    try {
      const { getDb } = await import("@/lib/db");
      const db = await getDb();

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      logger.info("Checking notification pipeline liveness", {
        windowHours: hours,
        since: since.toISOString(),
      });

      const count = await db.notificationMatches.count([
        { field: "matchedAt", op: ">=", value: since },
      ]);

      if (count === 0) {
        logger.error("Notification pipeline appears stalled", {
          windowHours: hours,
          since: since.toISOString(),
          notificationMatchesInWindow: 0,
        });
        await flushSentry();
        process.exit(1);
      }

      logger.info("Notification pipeline healthy", {
        windowHours: hours,
        notificationMatchesInWindow: count,
      });

      await flushSentry();
      process.exit(0);
    } catch (error) {
      logger.error(
        `Heartbeat check failed: ${error instanceof Error ? error.message : String(error)}`,
        { step: "heartbeat-check" },
      );
      await flushSentry();
      process.exit(1);
    }
  });

program.parse();
