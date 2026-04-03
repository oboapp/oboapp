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
interface ProcessStep {
  step: string;
  result: unknown;
}

function isProcessStep(v: unknown): v is ProcessStep {
  return isRecord(v) && typeof v.step === "string";
}

interface StoredStreetGeometry {
  key: string;
  originalName: string;
  geometry:
    | { type: "Feature"; geometry: { type: string; coordinates: number[][][] } }
    | string;
}

interface GeoJsonFeature {
  type: string;
  geometry: { type: string; coordinates: number[][][] };
}

function isGeoJsonFeature(v: unknown): v is GeoJsonFeature {
  if (!isRecord(v)) return false;
  const geom = v.geometry;
  if (!isRecord(geom)) return false;
  if (typeof geom.type !== "string") return false;
  return Array.isArray(geom.coordinates);
}

function isStoredStreetGeometry(v: unknown): v is StoredStreetGeometry {
  if (!isRecord(v)) return false;
  if (typeof v.key !== "string") return false;
  if (typeof v.originalName !== "string") return false;
  // geometry stored as JSON string (new format) or object (legacy)
  if (typeof v.geometry === "string") return true;
  const geo = v.geometry;
  if (!isRecord(geo)) return false;
  const inner = geo.geometry;
  return isRecord(inner) && inner.type === "MultiLineString";
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

    if (type === "pin") {
      const items: {
        messageId: string;
        lat: number;
        lng: number;
        formattedAddress: string;
      }[] = [];

      const pinMessages = await Promise.all(
        messageIds.map((id) => db.messages.findById(id)),
      );
      for (const [index, msg] of pinMessages.entries()) {
        if (!msg) continue;
        const id = messageIds[index];

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

      return NextResponse.json({ items });
    }

    // type === "street"
    const items: {
      messageId: string;
      coordinates: { lat: number; lng: number }[][];
    }[] = [];

    const streetMessages = await Promise.all(
      messageIds.map((id) => db.messages.findById(id)),
    );
    for (const [index, msg] of streetMessages.entries()) {
      if (!msg) continue;
      const id = messageIds[index];

      const rawProcess = msg.process ?? [];
      if (!Array.isArray(rawProcess)) continue;

      // Use the last streetGeometries step in case the message was re-ingested
      const processSteps = rawProcess.filter(isProcessStep);
      const streetGeometrySteps = processSteps.filter(
        (s) => s.step === "streetGeometries",
      );
      const step = streetGeometrySteps[streetGeometrySteps.length - 1];
      if (!step) continue;

      const rawGeometries = Array.isArray(step.result) ? step.result : [];
      const entry = rawGeometries
        .filter(isStoredStreetGeometry)
        .find((g) => g.key === key);
      if (!entry) continue;

      // geometry may be stored as a JSON string (new) or object (legacy)
      let multiLine: { type: string; coordinates: number[][][] } | null = null;
      if (typeof entry.geometry === "string") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(entry.geometry);
        } catch (err) {
          console.error("Invalid stored geometry JSON", { messageId: id, err });
          continue;
        }
        if (!isGeoJsonFeature(parsed)) continue;
        multiLine = parsed.geometry;
      } else {
        multiLine = entry.geometry.geometry;
      }
      if (multiLine.type !== "MultiLineString") continue;

      // Convert GeoJSON [lng, lat] → Google Maps { lat, lng }
      const coordinates = multiLine.coordinates.map((line) =>
        line
          .filter(
            ([lng, lat]) =>
              typeof lng === "number" && typeof lat === "number",
          )
          .map(([lng, lat]) => ({ lat, lng })),
      );

      items.push({ messageId: id, coordinates });
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("Failed to fetch geocode geometries", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
