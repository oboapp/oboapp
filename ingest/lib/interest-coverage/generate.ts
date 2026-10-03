import type { InterestCoverageImageReport } from "@oboapp/shared";
import { aggregateInterestCoverage } from "./aggregate";
import { validateJitterSecret } from "./jitter";

interface ReportDependencies {
  readInterests: () => Promise<Record<string, unknown>[]>;
  save: (report: InterestCoverageImageReport) => Promise<void>;
  jitterSecret: string;
}

/** Privacy is evaluated for each scheduled/manual snapshot, not on web requests. */
export async function generateInterestReport(deps: ReportDependencies, locality: string, dryRun = false) {
  validateJitterSecret(deps.jitterSecret);
  const records = await deps.readInterests();
  const report = aggregateInterestCoverage(records, locality, deps.jitterSecret);
  if (!dryRun) await deps.save(report);
  return report;
}
