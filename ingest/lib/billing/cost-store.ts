/**
 * GCS persistence for the monthly GCP billing cost report.
 *
 * Production: saves/loads `billing/cost-report.json` from GCS_GENERIC_BUCKET.
 * Offline / missing bucket: no-op read (returns null) and console warning on write.
 */

export interface ServiceCost {
  name: string;
  /** Gross usage cost before credits. */
  cost: number;
  /**
   * Total credits applied to this service (positive number = discount received).
   * Omitted when zero.
   */
  credits?: number;
}

export interface MonthlyBillingEntry {
  /** ISO year-month, e.g. "2026-05" */
  month: string;
  /** Total gross usage cost for the month (before credits). */
  total: number;
  /**
   * Total credits applied across all services for the month (positive = discount received).
   * Omitted when zero.
   */
  totalCredits?: number;
  /** Gross usage cost per GCP service with positive spend, sorted descending by cost. */
  byService: ServiceCost[];
}

export interface BillingCostReport {
  /** ISO timestamp when the report was last generated. */
  generatedAt: string;
  /** Billing currency code, e.g. "USD" or "EUR". */
  currency: string;
  /** Monthly entries, sorted newest-first. */
  months: MonthlyBillingEntry[];
}

const REPORT_PATH = "billing/cost-report.json";

let storage: import("@google-cloud/storage").Storage | null = null;

async function getStorage() {
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    storage = new Storage();
  }
  return storage;
}

export async function saveBillingCostReport(
  report: BillingCostReport,
): Promise<void> {
  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (!bucket) {
    console.warn("GCS_GENERIC_BUCKET not set — skipping GCS report save");
    return;
  }
  const gcs = await getStorage();
  const file = gcs.bucket(bucket).file(REPORT_PATH);
  await file.save(JSON.stringify(report, null, 2), {
    contentType: "application/json",
  });
  console.log(`Billing cost report saved to gs://${bucket}/${REPORT_PATH}`);
}

export async function loadBillingCostReport(): Promise<BillingCostReport | null> {
  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (!bucket) return null;
  const gcs = await getStorage();
  const file = gcs.bucket(bucket).file(REPORT_PATH);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [content] = await file.download();
  const data: BillingCostReport = JSON.parse(content.toString("utf-8"));
  return data;
}
