import type { InterestCoverageReport } from "@oboapp/shared";
import { aggregateInterestCoverage } from "./aggregate";

interface ReportDependencies {
  readInterests: () => Promise<Record<string, unknown>[]>;
  save: (report: InterestCoverageReport) => Promise<void>;
}

/** Privacy is evaluated for each scheduled/manual snapshot, not on web requests. */
export async function generateInterestReport(deps: ReportDependencies, locality: string, dryRun = false) {
  const records = await deps.readInterests();
  const report = aggregateInterestCoverage(records, locality);
  if (!dryRun) await deps.save(report);
  return report;
}
