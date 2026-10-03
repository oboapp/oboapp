#!/usr/bin/env tsx
/** Generate the public, privacy-suppressed interests/report.json GCS snapshot.
 * Usage: pnpm interest-coverage-report [--dry-run]
 * Dry-run prints only safe aggregate metadata and does not write to GCS.
 */
import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { generateInterestReport } from "@/lib/interest-coverage/generate";

const program = new Command();
program.name("interest-coverage-report")
  .description("Generate an aggregate interest heatmap image in GCS")
  .option("--dry-run", "Compute approved aggregate metadata without publishing")
  .addHelpText("after", "\nExamples:\n  pnpm interest-coverage-report\n  pnpm interest-coverage-report --dry-run\n")
  .action(async (opts: { dryRun?: boolean }) => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    const { getDb, closeDb } = await import("@/lib/db");
    const { saveInterestReport } = await import("@/lib/interest-coverage/report-store");
    try {
      const db = await getDb();
      const report = await generateInterestReport({
        readInterests: () => db.interests.findMany({ select: ["userId", "coordinates", "radius"] }),
        save: saveInterestReport,
        jitterSecret: process.env.INTEREST_COVERAGE_JITTER_SECRET ?? "",
      }, process.env.LOCALITY || "bg.sofia", opts.dryRun);
      console.log("Interest coverage report", { status: report.status, summary: report.summary, generatedAt: report.generatedAt, dryRun: !!opts.dryRun });
    } finally {
      await closeDb();
    }
  });
program.parseAsync().catch((error: unknown) => {
  console.error("Interest coverage report failed", error);
  process.exitCode = 1;
});
