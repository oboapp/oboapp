import {
  INTEREST_REPORT_PATH,
  InterestCoverageImageReportSchema,
} from "@oboapp/shared";
import type { InterestCoverageImageReport } from "@oboapp/shared";

let storage: import("@google-cloud/storage").Storage | undefined;

async function getBucket() {
  const name = process.env.GCS_GENERIC_BUCKET?.trim();
  if (!name) throw new Error("GCS_GENERIC_BUCKET must be configured to publish interest coverage");
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    storage = new Storage();
  }
  return storage.bucket(name);
}

export async function saveInterestReport(report: InterestCoverageImageReport) {
  const bucket = await getBucket();
  await bucket.file(INTEREST_REPORT_PATH).save(JSON.stringify(InterestCoverageImageReportSchema.parse(report)), {
    contentType: "application/json", resumable: false,
  });
}
