import { booleanIntersects, circle } from "@turf/turf";
import {
  GeoJsonFeatureSchema,
  GeoJsonGeometrySchema,
  GeoJsonPolygonSchema,
} from "@oboapp/shared";
import { z } from "zod";
import type { GeoJSONGeometry, Interest, Message } from "@/lib/types";

type ZoneEvent = Pick<Message, "id" | "geoJson" | "cityWide" | "locality">;
type Zone = Pick<Interest, "coordinates" | "radius">;
type ZoneCircle = ReturnType<typeof circle>;

export type LocalityBoundaries = Readonly<Record<string, unknown>>;

// Locality boundary files can contain MultiPolygon geometry.
const BoundaryFeatureSchema = GeoJsonFeatureSchema.extend({
  properties: GeoJsonFeatureSchema.shape.properties.nullish(),
  geometry: z.union([
    GeoJsonGeometrySchema,
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(GeoJsonPolygonSchema.shape.coordinates),
    }),
  ]),
});

function isValidPosition([longitude, latitude]: [number, number]): boolean {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
  );
}

function isValidRing(ring: [number, number][]): boolean {
  if (ring.length < 4 || !ring.every(isValidPosition)) {
    return false;
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isValidGeometry(geometry: GeoJSONGeometry): boolean {
  switch (geometry.type) {
    case "Point":
      return isValidPosition(geometry.coordinates);
    case "MultiPoint":
      return (
        geometry.coordinates.length > 0 &&
        geometry.coordinates.every(isValidPosition)
      );
    case "LineString":
      return (
        geometry.coordinates.length >= 2 &&
        geometry.coordinates.every(isValidPosition)
      );
    case "Polygon":
      return (
        geometry.coordinates.length > 0 &&
        geometry.coordinates.every(isValidRing)
      );
  }
}

function createZoneCircles(zones: readonly Zone[]): ZoneCircle[] {
  const circles: ZoneCircle[] = [];

  for (const zone of zones) {
    const { lng, lat } = zone.coordinates;
    if (
      !isValidPosition([lng, lat]) ||
      !Number.isFinite(zone.radius) ||
      zone.radius <= 0
    ) {
      continue;
    }

    circles.push(circle([lng, lat], zone.radius / 1000, { units: "kilometers" }));
  }

  return circles;
}

function getValidGeometries(feature: unknown): GeoJSONGeometry[] {
  const parsed = BoundaryFeatureSchema.safeParse(feature);
  if (!parsed.success) {
    return [];
  }

  const geometry = parsed.data.geometry;
  if (geometry.type === "MultiPolygon") {
    const polygons: GeoJSONGeometry[] = geometry.coordinates.map((coordinates) => {
      return { type: "Polygon", coordinates };
    });
    return polygons.filter(isValidGeometry);
  }

  return isValidGeometry(geometry) ? [geometry] : [];
}

function intersectsZones(
  collection: unknown,
  circles: readonly ZoneCircle[],
): boolean {
  if (
    typeof collection !== "object" ||
    collection === null ||
    !("type" in collection) ||
    collection.type !== "FeatureCollection" ||
    !("features" in collection) ||
    !Array.isArray(collection.features)
  ) {
    return false;
  }

  for (const feature of collection.features) {
    for (const geometry of getValidGeometries(feature)) {
      for (const zoneCircle of circles) {
        try {
          if (booleanIntersects(geometry, zoneCircle)) {
            return true;
          }
        } catch {
          // A malformed feature must not prevent other features from matching.
          continue;
        }
      }
    }
  }

  return false;
}

/**
 * Keep events whose geometry intersects a saved zone, preserving input order.
 * City-wide events use their locality boundary, matching notification semantics.
 * Missing locality boundaries and invalid geometry are excluded.
 */
export function filterEventsByZones<T extends ZoneEvent>(
  events: readonly T[],
  zones: readonly Zone[],
  localityBoundaries: LocalityBoundaries = {},
): T[] {
  const circles = createZoneCircles(zones);
  if (circles.length === 0) {
    return [];
  }

  const matchedIds = new Set<string>();

  return events.filter((event) => {
    if (event.id && matchedIds.has(event.id)) {
      return false;
    }

    const geometry = event.cityWide
      ? localityBoundaries[event.locality]
      : event.geoJson;

    if (!intersectsZones(geometry, circles)) {
      return false;
    }

    if (event.id) {
      matchedIds.add(event.id);
    }

    return true;
  });
}
