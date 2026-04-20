/**
 * GCS persistence for the heatmap snapshot.
 *
 * Production: saves/loads `heatmap/snapshot.json` from GCS_GENERIC_BUCKET.
 * Offline / missing bucket: no-op read (returns null) and console warning on write.
 */

export interface HeatmapMessage {
  id: string;
  source: string;
  categories: string[];
  cityWide: boolean;
  finalizedAt: string;
  /** Coordinate points in [lat, lng] order (Leaflet convention). */
  points: [number, number][];
}

export interface HeatmapSnapshot {
  generatedAt: string;
  messages: HeatmapMessage[];
}

const SNAPSHOT_PATH = "heatmap/snapshot.json";

let storage: import("@google-cloud/storage").Storage | null = null;

async function getStorage() {
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    storage = new Storage();
  }
  return storage;
}

export async function saveHeatmapSnapshot(
  snapshot: HeatmapSnapshot,
): Promise<void> {
  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (!bucket) {
    console.warn("GCS_GENERIC_BUCKET not set — skipping GCS snapshot save");
    return;
  }
  const gcs = await getStorage();
  const file = gcs.bucket(bucket).file(SNAPSHOT_PATH);
  await file.save(JSON.stringify(snapshot, null, 2), {
    contentType: "application/json",
  });
}

export async function loadHeatmapSnapshot(): Promise<HeatmapSnapshot | null> {
  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (!bucket) return null;
  const gcs = await getStorage();
  const file = gcs.bucket(bucket).file(SNAPSHOT_PATH);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [content] = await file.download();
  const data: HeatmapSnapshot = JSON.parse(content.toString("utf-8"));
  return data;
}
