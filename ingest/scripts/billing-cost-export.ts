#!/usr/bin/env tsx
/**
 * Generate a monthly GCP billing cost report from the BigQuery billing export.
 *
 * Reads billing data for up to the last N full months, builds a cumulative JSON
 * snapshot (total cost + per-service breakdown per month), and uploads it to GCS.
 * Run this near the beginning of each month to capture the previous month's data.
 *
 * Required env vars (maintainer-only, in .env.local):
 *   BILLING_BIGQUERY_PROJECT   — GCP project that owns the BigQuery dataset
 *   BILLING_BIGQUERY_DATASET   — BigQuery dataset name
 *   BILLING_BIGQUERY_TABLE     — Billing export table name
 *   BILLING_BIGQUERY_LOCATION  — Dataset location (default: "US")
 *
 * Also required for GCS upload:
 *   GCS_GENERIC_BUCKET         — Destination bucket (same as used by other reports)
 *
 * Authentication: Application Default Credentials (gcloud auth application-default login)
 *
 * Usage:
 *   pnpm billing-cost:export
 *   pnpm billing-cost:export --months 6
 *   pnpm billing-cost:export --include-current   # include current partial month
 *   pnpm billing-cost:export --dry-run           # print stats, skip GCS write
 *   pnpm billing-cost:export --out ./tmp/report.json  # also write JSON to a local file
 */

import { Command } from "commander";

const MIN_INCLUDED_MONTH = "2026-05";
const MIN_INCLUDED_MONTH_START_UTC = new Date(Date.UTC(2026, 4, 1)); // 2026-05-01

function diffMonthsUtc(later: Date, earlier: Date): number {
  return (
    (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
    (later.getUTCMonth() - earlier.getUTCMonth())
  );
}

const program = new Command();

program
  .name("billing-cost-export")
  .description("Generate a monthly GCP billing cost report and save to GCS")
  .option("--months <n>", "Number of past months to include (1–60)", "12")
  .option("--include-current", "Include the current (partial) calendar month")
  .option("--dry-run", "Print stats without writing to GCS")
  .option("--out <path>", "Also write the JSON report to a local file")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm billing-cost:export
  $ pnpm billing-cost:export --months 6
  $ pnpm billing-cost:export --include-current
  $ pnpm billing-cost:export --dry-run
  $ pnpm billing-cost:export --out ./tmp/report.json
`,
  )
  .action(
    async (opts: {
      months: string;
      includeCurrent?: boolean;
      dryRun?: boolean;
      out?: string;
    }) => {
      const { resolve } = await import("node:path");
      const { default: dotenv } = await import("dotenv");
      dotenv.config({ path: resolve(process.cwd(), ".env.local") });

      const months = Number.parseInt(opts.months, 10);
      if (!Number.isInteger(months) || months < 1 || months > 60) {
        console.error(
          `--months must be a positive integer between 1 and 60 (got: ${opts.months})`,
        );
        process.exit(1);
      }

      const project = process.env.BILLING_BIGQUERY_PROJECT;
      const dataset = process.env.BILLING_BIGQUERY_DATASET;
      const table = process.env.BILLING_BIGQUERY_TABLE;
      const location = process.env.BILLING_BIGQUERY_LOCATION ?? "US";

      if (!project || !dataset || !table) {
        console.error(
          "Missing required env vars: BILLING_BIGQUERY_PROJECT, BILLING_BIGQUERY_DATASET, BILLING_BIGQUERY_TABLE",
        );
        process.exit(1);
      }

      try {
        const { queryMonthlyCosts } =
          await import("@/lib/billing/bigquery-client");
        const { saveBillingCostReport } =
          await import("@/lib/billing/cost-store");

        console.log(
          `Querying BigQuery: ${project}.${dataset}.${table} (${location})`,
        );

        // Best-effort query clamp to avoid fetching months before 2026-05.
        // A strict output filter is still applied below as a hard guarantee.
        const currentMonthStartUtc = new Date(
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            1,
            0,
            0,
            0,
            0,
          ),
        );
        const maxLookbackFromCutoff = Math.max(
          0,
          diffMonthsUtc(currentMonthStartUtc, MIN_INCLUDED_MONTH_START_UTC),
        );
        const queryMonths = Math.max(
          1,
          Math.min(months, maxLookbackFromCutoff),
        );

        console.log(
          `Period: last ${queryMonths} month(s)${opts.includeCurrent ? " + current month" : ""} (never before ${MIN_INCLUDED_MONTH})`,
        );

        const result = await queryMonthlyCosts({
          project,
          dataset,
          table,
          location,
          months: queryMonths,
          includeCurrentMonth: opts.includeCurrent ?? false,
        });

        const monthsAfterCutoff = result.months.filter(
          (entry) => entry.month >= MIN_INCLUDED_MONTH,
        );

        if (monthsAfterCutoff.length < result.months.length) {
          console.log(
            `Applied cutoff: excluded ${result.months.length - monthsAfterCutoff.length} month(s) before ${MIN_INCLUDED_MONTH}`,
          );
        }

        if (monthsAfterCutoff.length === 0) {
          console.warn(
            `No billing data found for the requested period on/after ${MIN_INCLUDED_MONTH}. Check table name and date range.`,
          );
        }

        // Print a concise summary table
        console.log(`\nCurrency: ${result.currency}`);
        console.log(`Months retrieved: ${monthsAfterCutoff.length}\n`);
        for (const entry of monthsAfterCutoff) {
          console.log(
            `  ${entry.month}  total: ${result.currency} ${entry.total.toFixed(2)}  (${entry.byService.length} service(s))`,
          );
          for (const svc of entry.byService.slice(0, 5)) {
            console.log(
              `           ${svc.name.padEnd(40)} ${result.currency} ${svc.cost.toFixed(2)}`,
            );
          }
          if (entry.byService.length > 5) {
            console.log(
              `           … and ${entry.byService.length - 5} more service(s)`,
            );
          }
        }

        const report = {
          generatedAt: new Date().toISOString(),
          currency: result.currency,
          months: monthsAfterCutoff,
        };

        if (opts.out) {
          const { writeFile, mkdir } = await import("node:fs/promises");
          const { dirname, resolve: resolvePath } = await import("node:path");
          const outPath = resolvePath(opts.out);
          await mkdir(dirname(outPath), { recursive: true });
          await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");
          console.log(`Report written to ${outPath}`);
        }

        if (opts.dryRun) {
          console.log("\n[dry-run] Report not saved to GCS.");
          return;
        }

        await saveBillingCostReport(report);
      } catch (error) {
        console.error(
          "Fatal error:",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    },
  );

program.parseAsync().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
