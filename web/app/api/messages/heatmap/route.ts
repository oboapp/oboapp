import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface HeatmapMessage {
  id: string;
  source: string;
  categories: string[];
  cityWide: boolean;
  finalizedAt: string;
  /** Coordinate points in [lat, lng] order (Leaflet convention). */
  points: [number, number][];
}

interface HeatmapSnapshot {
  generatedAt: string;
  messages: HeatmapMessage[];
}

let storage: import("@google-cloud/storage").Storage | null = null;

async function getStorage() {
  if (!storage) {
    const { Storage } = await import("@google-cloud/storage");
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      storage = new Storage({ credentials });
    } else {
      storage = new Storage();
    }
  }
  return storage;
}

type HeatmapPoint = [number, number];

/**
 * GET /api/messages/heatmap
 *
 * Returns coordinate points for the history heatmap, loaded from a periodic GCS
 * snapshot instead of querying Firestore on every request.
 *
 * Optional query parameters:
 * - `categories` – comma-separated list of category names (including "uncategorized")
 * - `sources`    – comma-separated list of source IDs
 *
 * Response: { points: [lat, lng][], messageCount: number, oldestDate: string | null }
 */
export async function GET(request: Request) {
  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (!bucket) {
    return NextResponse.json(
      { error: "GCS_GENERIC_BUCKET not configured" },
      { status: 503 },
    );
  }

  let snapshot: HeatmapSnapshot;
  try {
    const gcs = await getStorage();
    const file = gcs.bucket(bucket).file("heatmap/snapshot.json");
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json(
        { error: "Heatmap snapshot not generated yet" },
        { status: 404 },
      );
    }
    const [content] = await file.download();
    const parsed: HeatmapSnapshot = JSON.parse(content.toString("utf-8"));
    if (!Array.isArray(parsed.messages)) {
      throw new Error("Snapshot is malformed: missing messages array");
    }
    snapshot = parsed;
  } catch (err) {
    console.error("Failed to load heatmap snapshot", err);
    return NextResponse.json(
      { error: "Failed to load heatmap snapshot" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const categoriesParam = searchParams.get("categories");
  const sourcesParam = searchParams.get("sources");

  const selectedCategoriesArr = categoriesParam
    ? categoriesParam
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : null;
  const selectedSourcesArr = sourcesParam
    ? sourcesParam
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : null;

  const filterCategories = (selectedCategoriesArr?.length ?? 0) > 0;
  const includeUncategorized =
    filterCategories &&
    selectedCategoriesArr?.includes("uncategorized") === true;
  const realCategoriesSet =
    filterCategories && selectedCategoriesArr
      ? new Set(selectedCategoriesArr.filter((c) => c !== "uncategorized"))
      : null;
  const selectedSourcesSet =
    selectedSourcesArr && selectedSourcesArr.length > 0
      ? new Set(selectedSourcesArr)
      : null;

  const points: HeatmapPoint[] = [];
  let messageCount = 0;
  let oldestDate: string | null = null;

  for (const msg of snapshot.messages) {
    if (msg.cityWide) continue;

    if (filterCategories) {
      const hasNoCategories = msg.categories.length === 0;
      const matchesUncategorized = includeUncategorized && hasNoCategories;
      const matchesCategory =
        !!realCategoriesSet &&
        realCategoriesSet.size > 0 &&
        msg.categories.some((cat) => realCategoriesSet.has(cat));
      if (!matchesUncategorized && !matchesCategory) continue;
    }

    if (selectedSourcesSet && !selectedSourcesSet.has(msg.source)) continue;

    messageCount++;

    if (msg.finalizedAt && (!oldestDate || msg.finalizedAt < oldestDate)) {
      oldestDate = msg.finalizedAt;
    }

    points.push(...msg.points);
  }

  return NextResponse.json(
    { points, messageCount, oldestDate },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
