/**
 * GCS persistence for the geocode cache frequency report.
 *
 * Production: saves/loads `geocode-cache/frequency-report.json` from GCS_GENERIC_BUCKET.
 * Offline / missing bucket: no-op read (returns null) and console warning on write.
 */

export interface FrequencyEntry {
  key: string;
  originalText: string;
  count: number;
  cached: boolean;
  messageIds: string[];
  /** Canonical normalized key for grouped street terms (present on street report entries). */
  canonicalKey?: string;
  /** Canonical display text for grouped street terms (present on street report entries). */
  canonicalText?: string;
  /** True if at least one source message has geocoding data but is not yet finalized. */
  partial?: true;
}

export interface GeocodeCacheFrequencyReport {
  generatedAt: string;
  messagesAnalyzed: number;
  pins: FrequencyEntry[];
  streets: FrequencyEntry[];
}

const REPORT_PATH = "geocode-cache/frequency-report.json";

let storage: import("@google-cloud/storage").Storage | null = null;

async function getStorage() {
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    storage = new Storage();
  }
  return storage;
}

export async function saveFrequencyReport(
  report: GeocodeCacheFrequencyReport,
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
}

export async function loadFrequencyReport(): Promise<GeocodeCacheFrequencyReport | null> {
  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (!bucket) return null;
  const gcs = await getStorage();
  const file = gcs.bucket(bucket).file(REPORT_PATH);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [content] = await file.download();
  const data: GeocodeCacheFrequencyReport = JSON.parse(
    content.toString("utf-8"),
  );
  return data;
}
