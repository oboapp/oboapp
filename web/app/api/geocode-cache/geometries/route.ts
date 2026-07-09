import { NextResponse } from "next/server";
import { normalizePinAddress } from "@oboapp/shared";
import { getDb } from "@/lib/db";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRecordArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every(isRecord);
}

function isCoordinates(v: unknown): v is { lat: number; lng: number } {
  return isRecord(v) && typeof v.lat === "number" && typeof v.lng === "number";
}

interface GeoJsonFeature {
  type: string;
  geometry: { type: string; coordinates: unknown };
}

interface GeoJsonPoint {
  type: string;
  coordinates: unknown;
}

function isGeoJsonFeature(v: unknown): v is GeoJsonFeature {
  if (!isRecord(v)) return false;
  const geom = v.geometry;
  if (!isRecord(geom)) return false;
  if (typeof geom.type !== "string") return false;
  return "coordinates" in geom;
}

function isGeoJsonPoint(v: unknown): v is GeoJsonPoint {
  return (
    isRecord(v) &&
    typeof v.type === "string" &&
    "coordinates" in v &&
    Array.isArray(v.coordinates)
  );
}

function toMapMultiLineCoordinates(
  value: unknown,
): { lat: number; lng: number }[][] | null {
  if (!Array.isArray(value)) return null;

  const lines: { lat: number; lng: number }[][] = [];
  for (const line of value) {
    if (!Array.isArray(line)) continue;

    const points: { lat: number; lng: number }[] = [];
    for (const point of line) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [lng, lat] = point;
      if (typeof lng !== "number" || typeof lat !== "number") continue;
      points.push({ lat, lng });
    }

    if (points.length > 0) {
      lines.push(points);
    }
  }

  return lines;
}

function toGeoJsonFeature(value: unknown): GeoJsonFeature | null {
  if (isGeoJsonFeature(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isGeoJsonFeature(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toGeoJsonPoint(value: unknown): GeoJsonPoint | null {
  if (isGeoJsonPoint(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isGeoJsonPoint(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function resolveCachedStreetGeometry(
  db: Awaited<ReturnType<typeof getDb>>,
  key: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await db.geocodeCacheStreets.findByKey(key);
  } catch (err) {
    void err;
    return null;
  }
}

interface GeocodingPinEntry {
  key: string;
  formattedAddress?: string;
  coordinates: unknown;
}

interface GeocodingStreetEntry {
  key: string;
  geometry: string;
}

function isGeocodingPinEntry(v: unknown): v is GeocodingPinEntry {
  return isRecord(v) && typeof v["key"] === "string";
}

function isGeocodingStreetEntry(v: unknown): v is GeocodingStreetEntry {
  return (
    isRecord(v) &&
    typeof v["key"] === "string" &&
    typeof v["geometry"] === "string"
  );
}

type GeocodingStepData = {
  pins: GeocodingPinEntry[];
  streets: GeocodingStreetEntry[];
};

/**
 * Extract geocoded pins and streets from a message's process[] array.
 * Prefers the final `geocoding` step. For interrupted runs (no `geocoding` step),
 * falls back to merging all `geocodingBatch` entries for the most recent runId.
 */
function extractGeocodingData(msg: Record<string, unknown>): GeocodingStepData {
  const rawProcess = msg["process"];
  if (!Array.isArray(rawProcess)) return { pins: [], streets: [] };

  const steps = rawProcess.filter(
    (s): s is Record<string, unknown> =>
      isRecord(s) && typeof s["step"] === "string",
  );

  // Prefer last completed geocoding step
  const geocodingSteps = steps.filter((s) => s["step"] === "geocoding");
  if (geocodingSteps.length > 0) {
    const last = geocodingSteps[geocodingSteps.length - 1];
    return {
      pins: Array.isArray(last["pins"])
        ? last["pins"].filter(isGeocodingPinEntry)
        : [],
      streets: Array.isArray(last["streets"])
        ? last["streets"].filter(isGeocodingStreetEntry)
        : [],
    };
  }

  // Fall back: merge geocodingBatch entries for the most recent runId (interrupted run)
  const batchSteps = steps.filter(
    (s): s is Record<string, unknown> & { runId: string } =>
      s["step"] === "geocodingBatch" && typeof s["runId"] === "string",
  );
  if (batchSteps.length > 0) {
    const lastRunId = batchSteps[batchSteps.length - 1].runId;
    const batchesForRun = batchSteps.filter((s) => s.runId === lastRunId);
    return {
      pins: batchesForRun.flatMap((s) =>
        Array.isArray(s["pins"]) ? s["pins"].filter(isGeocodingPinEntry) : [],
      ),
      streets: batchesForRun.flatMap((s) =>
        Array.isArray(s["streets"])
          ? s["streets"].filter(isGeocodingStreetEntry)
          : [],
      ),
    };
  }

  return { pins: [], streets: [] };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const key = searchParams.get("key");
  const messageIdsParam = searchParams.get("messageIds");

  if (type !== "pin" && type !== "street") {
    return NextResponse.json(
      { error: "type must be pin or street" },
      { status: 400 },
    );
  }
  if (!key || !messageIdsParam) {
    return NextResponse.json(
      { error: "key and messageIds are required" },
      { status: 400 },
    );
  }

  const messageIds = messageIdsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 20); // guard against abuse

  try {
    const db = await getDb();
    const messages = await Promise.all(
      messageIds.map(async (id) => {
        try {
          return await db.messages.findById(id);
        } catch (err) {
          void err;
          return null;
        }
      }),
    );

    if (type === "pin") {
      const items: {
        messageId: string;
        lat: number;
        lng: number;
        formattedAddress: string;
      }[] = [];

      for (const [index, msg] of messages.entries()) {
        if (!msg) continue;
        const id = messageIds[index];

        // Primary: geocoding step pins (supports both complete and interrupted runs)
        const { pins } = extractGeocodingData(msg);
        const pinEntry = pins.find((p) => p.key === key);
        if (pinEntry && isCoordinates(pinEntry.coordinates)) {
          items.push({
            messageId: id,
            lat: pinEntry.coordinates.lat,
            lng: pinEntry.coordinates.lng,
            formattedAddress:
              typeof pinEntry.formattedAddress === "string"
                ? pinEntry.formattedAddress
                : key,
          });
          continue;
        }

        // Fallback: message.addresses[] (for messages ingested before the geocoding step)
        const rawAddresses = msg.addresses ?? [];
        if (!isRecordArray(rawAddresses)) continue;
        const match = rawAddresses.find(
          (a) =>
            normalizePinAddress(
              typeof a.originalText === "string" ? a.originalText : "",
            ) === key ||
            normalizePinAddress(
              typeof a.formattedAddress === "string" ? a.formattedAddress : "",
            ) === key,
        );
        if (!match) continue;
        if (!isCoordinates(match.coordinates)) continue;
        items.push({
          messageId: id,
          lat: match.coordinates.lat,
          lng: match.coordinates.lng,
          formattedAddress:
            typeof match.formattedAddress === "string"
              ? match.formattedAddress
              : key,
        });
      }

      if (items.length === 0) {
        let cacheEntry: Record<string, unknown> | null = null;
        try {
          cacheEntry = await db.geocodeCachePins.findByKey(key);
        } catch (err) {
          void err;
        }
        if (cacheEntry) {
          if (isCoordinates(cacheEntry["coordinates"])) {
            items.push({
              messageId:
                typeof cacheEntry["sourceMessageId"] === "string"
                  ? cacheEntry["sourceMessageId"]
                  : "cache",
              lat: cacheEntry["coordinates"].lat,
              lng: cacheEntry["coordinates"].lng,
              formattedAddress:
                typeof cacheEntry["formattedAddress"] === "string"
                  ? cacheEntry["formattedAddress"]
                  : typeof cacheEntry["originalText"] === "string"
                    ? cacheEntry["originalText"]
                    : key,
            });
          } else {
            const point = toGeoJsonPoint(cacheEntry["geoJson"]);
            if (
              point &&
              point.type === "Point" &&
              Array.isArray(point.coordinates) &&
              point.coordinates.length >= 2
            ) {
              const [lng, lat] = point.coordinates;
              if (typeof lng === "number" && typeof lat === "number") {
                items.push({
                  messageId:
                    typeof cacheEntry["sourceMessageId"] === "string"
                      ? cacheEntry["sourceMessageId"]
                      : "cache",
                  lat,
                  lng,
                  formattedAddress:
                    typeof cacheEntry["formattedAddress"] === "string"
                      ? cacheEntry["formattedAddress"]
                      : typeof cacheEntry["originalText"] === "string"
                        ? cacheEntry["originalText"]
                        : key,
                });
              }
            }
          }
        }
      }

      return NextResponse.json({ items });
    }

    // type === "street"
    const items: {
      messageId: string;
      coordinates: { lat: number; lng: number }[][];
    }[] = [];

    for (const [index, msg] of messages.entries()) {
      if (!msg) continue;
      const id = messageIds[index];

      const { streets } = extractGeocodingData(msg);
      const entry = streets.find((s) => s.key === key);
      if (!entry) continue;

      const parsed = toGeoJsonFeature(entry.geometry);
      if (!parsed) continue;
      if (!isGeoJsonFeature(parsed)) continue;
      const multiLine = parsed.geometry;
      if (multiLine.type !== "MultiLineString") continue;

      // Convert GeoJSON [lng, lat] → Google Maps { lat, lng }, tolerating malformed points.
      const coordinates = toMapMultiLineCoordinates(multiLine.coordinates);
      if (!coordinates || coordinates.length === 0) continue;

      items.push({ messageId: id, coordinates });
    }

    if (items.length === 0) {
      const cacheEntry = await resolveCachedStreetGeometry(db, key);
      if (cacheEntry) {
        const parsed = toGeoJsonFeature(cacheEntry["geoJson"]);
        if (parsed && parsed.geometry.type === "MultiLineString") {
          const coordinates = toMapMultiLineCoordinates(
            parsed.geometry.coordinates,
          );
          if (coordinates && coordinates.length > 0) {
            items.push({
              messageId:
                typeof cacheEntry["sourceMessageId"] === "string"
                  ? cacheEntry["sourceMessageId"]
                  : "cache",
              coordinates,
            });
          }
        }
      }
    }

    return NextResponse.json({ items });
  } catch (err) {
    void err;
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
