import { INTEREST_REPORT_PATH, InterestCoverageReportSchema } from "@oboapp/shared";

let storage: import("@google-cloud/storage").Storage | undefined;

/** Read the pre-generated JSON, following the other public report endpoints. */
export async function loadInterestReport() {
  const name = process.env.GCS_GENERIC_BUCKET?.trim();
  if (!name) return null;
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    storage = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? new Storage({ credentials: JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) })
      : new Storage();
  }
  try {
    const [content] = await storage.bucket(name).file(INTEREST_REPORT_PATH).download();
    return InterestCoverageReportSchema.parse(JSON.parse(content.toString("utf-8")));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 404) return null;
    throw error;
  }
}
