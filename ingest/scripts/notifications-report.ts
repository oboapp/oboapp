#!/usr/bin/env tsx
import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";

const program = new Command();
program
  .name("notifications-report")
  .description("Generate the weekly notifications report snapshot")
  .option("--dry-run", "Print aggregate statistics without writing to GCS")
  .action(async (options: { dryRun?: boolean }) => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    const { getDb, closeDb } = await import("@/lib/db");
    const { logger } = await import("@/lib/logger");
    const { generateNotificationsReport } = await import(
      "@/lib/notifications/report-generator"
    );
    const { saveNotificationsReportSnapshot } = await import(
      "@/lib/notifications/report-store"
    );
    try {
      if (!options.dryRun && !process.env.GCS_GENERIC_BUCKET?.trim()) {
        throw new Error(
          "GCS_GENERIC_BUCKET is required to save the notifications report",
        );
      }
      const snapshot = await generateNotificationsReport(await getDb());
      logger.info("Notifications report generated", { ...snapshot.kpis });
      if (!options.dryRun) await saveNotificationsReportSnapshot(snapshot);
    } catch (error) {
      logger.error("Notifications report generation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
