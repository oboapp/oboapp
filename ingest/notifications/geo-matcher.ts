import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as turf from "@turf/turf";
import type { Message, Interest, GeoJSONFeatureCollection } from "@/lib/types";
import { logger } from "@/lib/logger";
import { validateLocality } from "@oboapp/shared";
import { isFeatureCollection } from "@/lib/record-fields";

// Cache GeoJSON files by locality
const geoJsonCache = new Map<string, GeoJSONFeatureCollection>();

/**
 * Load locality GeoJSON file (cached)
 * Files should be named {locality}.geojson under localities/ (e.g., localities/bg.sofia.geojson)
 * @throws Error if locality is invalid or file not found
 */
function loadLocalityGeoJson(locality: string): GeoJSONFeatureCollection {
  // Validate locality to prevent path traversal
  validateLocality(locality);
  
  if (!geoJsonCache.has(locality)) {
    const path = resolve(process.cwd(), "localities", `${locality}.geojson`);
    const content = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!isFeatureCollection(parsed)) {
      throw new Error(`Invalid GeoJSON in locality file: ${path}`);
    }
    geoJsonCache.set(locality, parsed);
  }
  return geoJsonCache.get(locality)!;
}

/**
 * Check if a message's GeoJSON features intersect with a user's interest circle
 * For city-wide messages (cityWide flag), uses the locality's geojson for geometric matching
 */
export function matchMessageToInterest(
  message: Message,
  interest: Interest,
): { matches: boolean; distance: number | null } {
  // City-wide messages use locality boundary for matching
  let geoJson = message.geoJson;
  if (message.cityWide) {
    geoJson = loadLocalityGeoJson(message.locality);
  }

  if (!geoJson?.features || geoJson.features.length === 0) {
    return { matches: false, distance: null };
  }

  const interestPoint = turf.point([
    interest.coordinates.lng,
    interest.coordinates.lat,
  ]);
  const interestCircle = turf.circle(
    interestPoint,
    interest.radius / 1000, // Convert meters to kilometers
    { units: "kilometers" },
  );

  let minDistance: number | null = null;

  for (const feature of geoJson.features) {
    try {
      // Check if feature intersects with interest circle
      const intersects = turf.booleanIntersects(feature, interestCircle);

      if (intersects) {
        // Calculate distance to get the closest point using pointToLineDistance or centroid
        let distance: number;
        if (feature.geometry.type === "Point") {
          distance = turf.distance(
            interestPoint,
            feature.geometry.coordinates,
            { units: "meters" },
          );
        } else {
          // For LineString and Polygon, calculate distance to centroid
          const centroid = turf.centroid(feature);
          distance = turf.distance(interestPoint, centroid, {
            units: "meters",
          });
        }

        if (minDistance === null || distance < minDistance) {
          minDistance = distance;
        }
      }
    } catch (error) {
      logger.warn("Error checking intersection for feature", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { matches: minDistance !== null, distance: minDistance };
}
