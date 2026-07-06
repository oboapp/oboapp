import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getConfiguredLocality,
  LOCALITY_ENV_ERROR_MESSAGE,
} from "@/lib/locality-metadata";
import {
  getBoundsForLocality,
  calculateNowCastAqi,
  getAqiLabel,
  getAqiCategory,
} from "@oboapp/shared";
import type { HourlyAverage } from "@oboapp/shared";
import type { Storage } from "@google-cloud/storage";

export const runtime = "nodejs";

const CELL_SIZE_KM = 4;
const KM_PER_DEGREE_LAT = 111.0;
const EVALUATION_WINDOW_HOURS = 4;
const MAX_STALENESS_MS = 45 * 60 * 1000;
const SOURCE_ID = "sensor-community";
// GCS data updates every 30 min — cache for 5 min to reduce latency/cost
const GCS_CACHE_TTL_MS = 5 * 60 * 1000;

interface StoredReading {
  sensorId: number;
  timestamp: string;
  lat: number;
  lng: number;
  p1: number;
  p2: number;
}

interface GridCell {
  id: string;
  south: number;
  north: number;
  west: number;
  east: number;
}

// In-memory cache keyed by locality
const gcsCache = new Map<
  string,
  { data: StoredReading[] | null; fetchedAt: number }
>();

// Module-level Storage singleton — created once on first GCS access
let storageInstance: Storage | null = null;

async function getStorageInstance(): Promise<Storage> {
  if (storageInstance) return storageInstance;

  const { Storage } = await import("@google-cloud/storage");
  // Reuse FIREBASE_SERVICE_ACCOUNT_KEY when present (same key already used by the
  // Firebase Admin SDK in this process). Falls back to ADC in GCP-managed environments.
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  let credentials: object | undefined;
  if (serviceAccountKey) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serviceAccountKey);
    } catch (parseErr) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_KEY contains invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      credentials = parsed;
    } else {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY must be a JSON object");
    }
  }
  storageInstance = credentials ? new Storage({ credentials }) : new Storage();
  return storageInstance;
}

function buildGrid(locality: string): GridCell[] {
  const bounds = getBoundsForLocality(locality);
  const centerLat = (bounds.south + bounds.north) / 2;
  const kmPerDegreeLng =
    KM_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);

  const latSpanKm = (bounds.north - bounds.south) * KM_PER_DEGREE_LAT;
  const lngSpanKm = (bounds.east - bounds.west) * kmPerDegreeLng;

  const rows = Math.ceil(latSpanKm / CELL_SIZE_KM);
  const cols = Math.ceil(lngSpanKm / CELL_SIZE_KM);

  const latStep = (bounds.north - bounds.south) / rows;
  const lngStep = (bounds.east - bounds.west) / cols;

  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        id: `r${r}c${c}`,
        south: bounds.south + r * latStep,
        north: bounds.south + (r + 1) * latStep,
        west: bounds.west + c * lngStep,
        east: bounds.west + (c + 1) * lngStep,
      });
    }
  }
  return cells;
}

function assignToCell(
  grid: GridCell[],
  lat: number,
  lng: number,
  maxNorth: number,
  maxEast: number,
): GridCell | null {
  for (const cell of grid) {
    const withinLat =
      lat >= cell.south && (lat < cell.north || cell.north === maxNorth);
    const withinLng =
      lng >= cell.west && (lng < cell.east || cell.east === maxEast);
    if (withinLat && withinLng) {
      return cell;
    }
  }
  return null;
}

async function readGcsReadings(
  locality: string,
): Promise<StoredReading[] | null> {
  // Serve from cache if still fresh
  const cached = gcsCache.get(locality);
  if (cached && Date.now() - cached.fetchedAt < GCS_CACHE_TTL_MS) {
    return cached.data;
  }

  let data: StoredReading[] | null = null;

  const bucket = process.env.GCS_GENERIC_BUCKET;
  if (bucket) {
    const storage = await getStorageInstance();
    const file = storage
      .bucket(bucket)
      .file(`air-quality/${locality}/readings.json`);
    try {
      const [content] = await file.download();
      try {
        const parsed = JSON.parse(content.toString("utf-8"));
        data = Array.isArray(parsed) ? parsed : null;
      } catch {
        // Malformed JSON in GCS file — treat as no data
        data = null;
      }
    } catch (err: unknown) {
      const isNotFound =
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err.code === 404 || err.code === "404");
      if (isNotFound) {
        data = null;
      } else {
        throw err;
      }
    }
  } else {
    // Local dev fallback — only permitted outside production.
    // In production a missing GCS_GENERIC_BUCKET is a misconfiguration; callers
    // should catch the 503 returned by GET() and not reach this branch.
    const basePath =
      process.env.LOCAL_READINGS_PATH ?? "./tmp/air-quality";
    const { readFile } = await import("node:fs/promises");
    try {
      const content = await readFile(
        `${basePath}/${locality}/readings.json`,
        "utf-8",
      );
      const parsed = JSON.parse(content);
      data = Array.isArray(parsed) ? parsed : null;
    } catch {
      data = null;
    }
  }

  gcsCache.set(locality, { data, fetchedAt: Date.now() });
  return data;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const localityFromQuery = searchParams.get("locality");
  let locality: string;
  if (localityFromQuery !== null) {
    locality = localityFromQuery;
  } else {
    try {
      locality = getConfiguredLocality();
    } catch (err) {
      console.error(
        "Missing NEXT_PUBLIC_LOCALITY configuration for /api/air-quality/status",
        err,
      );
      return NextResponse.json(
        { error: LOCALITY_ENV_ERROR_MESSAGE },
        { status: 500 },
      );
    }
  }

  if (
    process.env.NODE_ENV === "production" &&
    !process.env.GCS_GENERIC_BUCKET
  ) {
    return NextResponse.json(
      { error: "GCS_GENERIC_BUCKET is not configured" },
      { status: 503 },
    );
  }

  try {
    getBoundsForLocality(locality); // validate locality
  } catch {
    return NextResponse.json({ error: "Unknown locality" }, { status: 400 });
  }

  try {
    const [allReadings, db] = await Promise.all([
      readGcsReadings(locality),
      getDb(),
    ]);

    const now = Date.now();
    const windowStart = now - EVALUATION_WINDOW_HOURS * 60 * 60 * 1000;

    // Single pass: compute summary stats and build per-cell hour bins simultaneously.
    // Parse r.timestamp once per reading to avoid redundant Date allocations.
    const readings: StoredReading[] = allReadings ?? [];
    const uniqueSensors = new Set(readings.map((r) => r.sensorId)).size;
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;

    const grid = buildGrid(locality);
    const gridMaxNorth = grid.reduce((m, c) => Math.max(m, c.north), -Infinity);
    const gridMaxEast = grid.reduce((m, c) => Math.max(m, c.east), -Infinity);
    const cellMap = new Map<
      string,
      { sensorIds: Set<number>; hourBins: Map<number, { p1: number[]; p2: number[] }> }
    >();

    for (const r of readings) {
      const t = Date.parse(r.timestamp);
      if (!Number.isFinite(t)) continue;

      // Update 24h summary stats
      if (oldestTimestamp === null || t < oldestTimestamp) oldestTimestamp = t;
      if (newestTimestamp === null || t > newestTimestamp) newestTimestamp = t;

      // Accumulate into cells only for the evaluation window
      if (t < windowStart) continue;

      const cell = assignToCell(grid, r.lat, r.lng, gridMaxNorth, gridMaxEast);
      if (!cell) continue;

      if (!cellMap.has(cell.id)) {
        cellMap.set(cell.id, {
          sensorIds: new Set(),
          hourBins: new Map(),
        });
      }
      const entry = cellMap.get(cell.id)!;
      entry.sensorIds.add(r.sensorId);

      const hourBin = Math.floor(t / 3_600_000);
      if (!entry.hourBins.has(hourBin)) {
        entry.hourBins.set(hourBin, { p1: [], p2: [] });
      }
      const bin = entry.hourBins.get(hourBin)!;
      bin.p1.push(r.p1);
      bin.p2.push(r.p2);
    }

    const oldestAt = oldestTimestamp !== null ? new Date(oldestTimestamp).toISOString() : null;
    const newestAt = newestTimestamp !== null ? new Date(newestTimestamp).toISOString() : null;
    const isStale = newestTimestamp === null || now - newestTimestamp > MAX_STALENESS_MS;

    // Build a lookup from cell id → GridCell for bounds
    const gridById = new Map(grid.map((c) => [c.id, c]));

    const cells = Array.from(cellMap.entries())
      .map(([id, { sensorIds, hourBins }]) => {
        // Build hourly averages ordered most-recent first
        const sortedBins = Array.from(hourBins.entries()).sort(
          ([a], [b]) => b - a,
        );
        const hourlyAverages: HourlyAverage[] = sortedBins.map(
          ([, { p1, p2 }]) => ({
            pm10: p1.reduce((s, v) => s + v, 0) / p1.length,
            pm25: p2.reduce((s, v) => s + v, 0) / p2.length,
          }),
        );

        const rawAqi = calculateNowCastAqi(hourlyAverages);
        const aqi = rawAqi > 0 ? rawAqi : null;
        const cell = gridById.get(id);
        return {
          id,
          aqi,
          aqiLabel: aqi !== null ? getAqiLabel(aqi) : null,
          aqiCategory: aqi !== null ? getAqiCategory(aqi) : null,
          sensorCount: sensorIds.size,
          bounds: cell
            ? { south: cell.south, north: cell.north, west: cell.west, east: cell.east }
            : null,
        };
      })
      .sort((a, b) => {
        if (a.aqi === null && b.aqi === null) return 0;
        if (a.aqi === null) return 1;
        if (b.aqi === null) return -1;
        return b.aqi - a.aqi;
      });

    const maxAqi = cells.find((cell) => cell.aqi !== null)?.aqi ?? null;

    const [messageCount, notificationCount] = await Promise.all([
      db.messages.count([{ field: "source", op: "==", value: SOURCE_ID }]),
      db.notificationMatches.count([
        { field: "messageSnapshot.source", op: "==", value: SOURCE_ID },
      ]),
    ]);

    return NextResponse.json({
      locality,
      updatedAt: new Date().toISOString(),
      readings: {
        count: readings.length,
        uniqueSensors,
        oldestAt,
        newestAt,
        isStale,
      },
      cells,
      maxAqi,
      stats: {
        messageCount,
        notificationCount,
      },
    });
  } catch (error) {
    console.error("Error fetching air quality status:", error);
    return NextResponse.json(
      { error: "Failed to fetch air quality status" },
      { status: 500 },
    );
  }
}
