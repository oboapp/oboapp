import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getBoundsForLocality,
  calculateNowCastAqi,
  getAqiLabel,
  getAqiCategory,
} from "@oboapp/shared";
import type { HourlyAverage } from "@oboapp/shared";

const CELL_SIZE_KM = 4;
const KM_PER_DEGREE_LAT = 111.0;
const EVALUATION_WINDOW_HOURS = 4;
const MAX_STALENESS_MS = 45 * 60 * 1000;
const SOURCE_ID = "sensor-community";

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
): GridCell | null {
  return (
    grid.find(
      (c) => lat >= c.south && lat <= c.north && lng >= c.west && lng <= c.east,
    ) ?? null
  );
}

async function readGcsReadings(
  locality: string,
): Promise<StoredReading[] | null> {
  const bucket = process.env.GCS_READINGS_BUCKET;
  if (bucket) {
    const { Storage } = await import("@google-cloud/storage");
    // Reuse FIREBASE_SERVICE_ACCOUNT_KEY when present (same key already used by the
    // Firebase Admin SDK in this process). Falls back to ADC in GCP-managed environments.
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const storage = serviceAccountKey
      ? new Storage({ credentials: JSON.parse(serviceAccountKey) })
      : new Storage();
    const file = storage
      .bucket(bucket)
      .file(`air-quality/${locality}/readings.json`);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return JSON.parse(content.toString("utf-8"));
  }

  // Local dev fallback
  const basePath =
    process.env.LOCAL_READINGS_PATH ?? "./tmp/air-quality";
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(
      `${basePath}/${locality}/readings.json`,
      "utf-8",
    );
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locality = searchParams.get("locality") ?? "bg.sofia";

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

    // Summary stats over the full 24h retention window
    const readings: StoredReading[] = allReadings ?? [];
    const uniqueSensors = new Set(readings.map((r) => r.sensorId)).size;
    const timestamps = readings.map((r) => new Date(r.timestamp).getTime());
    const oldestAt =
      timestamps.length > 0
        ? new Date(Math.min(...timestamps)).toISOString()
        : null;
    const newestAt =
      timestamps.length > 0
        ? new Date(Math.max(...timestamps)).toISOString()
        : null;
    const isStale =
      newestAt === null ||
      now - new Date(newestAt).getTime() > MAX_STALENESS_MS;

    // Per-cell AQI using the last 4-hour evaluation window
    const windowReadings = readings.filter(
      (r) => new Date(r.timestamp).getTime() >= windowStart,
    );

    const grid = buildGrid(locality);
    const cellMap = new Map<
      string,
      { sensorIds: Set<number>; hourBins: Map<number, { p1: number[]; p2: number[] }> }
    >();

    for (const r of windowReadings) {
      const cell = assignToCell(grid, r.lat, r.lng);
      if (!cell) continue;

      if (!cellMap.has(cell.id)) {
        cellMap.set(cell.id, {
          sensorIds: new Set(),
          hourBins: new Map(),
        });
      }
      const entry = cellMap.get(cell.id)!;
      entry.sensorIds.add(r.sensorId);

      const hourBin = Math.floor(new Date(r.timestamp).getTime() / 3_600_000);
      if (!entry.hourBins.has(hourBin)) {
        entry.hourBins.set(hourBin, { p1: [], p2: [] });
      }
      const bin = entry.hourBins.get(hourBin)!;
      bin.p1.push(r.p1);
      bin.p2.push(r.p2);
    }

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

        const aqi = calculateNowCastAqi(hourlyAverages);
        const cell = gridById.get(id);
        return {
          id,
          aqi,
          aqiLabel: getAqiLabel(aqi),
          aqiCategory: getAqiCategory(aqi),
          sensorCount: sensorIds.size,
          bounds: cell
            ? { south: cell.south, north: cell.north, west: cell.west, east: cell.east }
            : null,
        };
      })
      .sort((a, b) => b.aqi - a.aqi);

    const maxAqi = cells.length > 0 ? cells[0].aqi : 0;

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
