import * as turf from "@turf/turf";
import type { Feature } from "geojson";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "@/lib/logger";
import type { GeoJSONFeatureCollection, GeoJSONFeature } from "./types";

// Cache boundaries by absolute path to avoid re-reading files
const boundaryCache = new Map<string, GeoJSONFeatureCollection>();

/**
 * Load geographic boundaries for a locality from its GeoJSON file.
 * Files should be in localities/{locality}.geojson (e.g., localities/bg.sofia.geojson)
 * Results are cached to avoid re-reading files.
 */
export function loadBoundariesForLocality(
  locality: string,
): GeoJSONFeatureCollection {
  const filename = `localities/${locality}.geojson`;
  const absolutePath = resolve(process.cwd(), filename);

  // Check cache first
  if (boundaryCache.has(absolutePath)) {
    return boundaryCache.get(absolutePath)!;
  }

  try {
    const content = readFileSync(absolutePath, "utf-8");
    const geojson: GeoJSONFeatureCollection = JSON.parse(content);

    // Cache the result
    boundaryCache.set(absolutePath, geojson);

    return geojson;
  } catch (error) {
    logger.error("Failed to load boundaries for locality", { locality, path: absolutePath, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Load optional geographic boundaries from a GeoJSON file for filtering.
 * If no path is provided, all sources will be processed.
 * Results are cached to avoid re-reading files.
 */
export function loadBoundaries(
  boundariesPath?: string,
): GeoJSONFeatureCollection | null {
  if (!boundariesPath) {
    return null;
  }

  const absolutePath = resolve(process.cwd(), boundariesPath);

  // Check cache first
  if (boundaryCache.has(absolutePath)) {
    return boundaryCache.get(absolutePath)!;
  }

  try {
    const content = readFileSync(absolutePath, "utf-8");
    const geojson: GeoJSONFeatureCollection = JSON.parse(content);

    // Cache the result
    boundaryCache.set(absolutePath, geojson);

    return geojson;
  } catch (error) {
    logger.error("Failed to load boundaries", { boundariesPath, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Check if bounding boxes overlap (fallback method)
 */
function checkBoundingBoxOverlap(
  turfFeature: Feature,
  turfBoundary: Feature,
  geometryType: string,
  originalError: unknown,
): boolean {
  try {
    const featureBbox = turf.bbox(turfFeature);
    const boundaryBbox = turf.bbox(turfBoundary);

    // Check if bounding boxes overlap
    const overlaps = !(
      (
        featureBbox[2] < boundaryBbox[0] || // feature is completely to the left
        featureBbox[0] > boundaryBbox[2] || // feature is completely to the right
        featureBbox[3] < boundaryBbox[1] || // feature is completely below
        featureBbox[1] > boundaryBbox[3]
      ) // feature is completely above
    );

    if (overlaps) {
      return true;
    }

    return false;
  } catch (error) {
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    const bboxErrorMessage =
      error instanceof Error ? error.message : String(error);
    logger.warn("Could not check geometry intersection, bbox check also failed, including by default", { intersectionError: errorMessage, bboxError: bboxErrorMessage });
    return true;
  }
}

/**
 * Check if a feature intersects with any boundary feature
 */
export function checkFeatureIntersection(
  feature: GeoJSONFeature,
  boundaries: GeoJSONFeatureCollection,
): boolean {
  const turfFeature = turf.feature(feature.geometry, feature.properties);

  for (const boundaryFeature of boundaries.features) {
    const turfBoundary = turf.feature(
      boundaryFeature.geometry,
      boundaryFeature.properties,
    );

    try {
      // Check if geometries intersect
      if (
        turf.booleanIntersects(turfFeature, turfBoundary) ||
        turf.booleanWithin(turfFeature, turfBoundary) ||
        turf.booleanContains(turfBoundary, turfFeature)
      ) {
        return true;
      }
    } catch (intersectError) {
      // Some geometry types might not support all comparison operations
      // Try a simpler bounding box check instead
      if (
        checkBoundingBoxOverlap(
          turfFeature,
          turfBoundary,
          feature.geometry.type,
          intersectError,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter GeoJSON features to only include those within boundaries
 * Returns a new FeatureCollection with only features that intersect the boundaries
 * Returns null if no features are within boundaries
 */
export function filterFeaturesByBoundaries(
  sourceGeoJson: GeoJSONFeatureCollection | null,
  boundaries: GeoJSONFeatureCollection,
): GeoJSONFeatureCollection | null {
  if (!sourceGeoJson?.features || sourceGeoJson.features.length === 0) {
    return null;
  }

  const filteredFeatures = sourceGeoJson.features.filter((feature) => {
    if (!feature.geometry?.coordinates) {
      logger.warn("Skipping feature without valid geometry");
      return false;
    }

    return checkFeatureIntersection(feature, boundaries);
  });

  if (filteredFeatures.length === 0) {
    return null;
  }

  return {
    type: "FeatureCollection",
    features: filteredFeatures,
  };
}

/**
 * Check if a GeoJSON FeatureCollection is within boundaries
 */
export function isWithinBoundaries(
  sourceGeoJson: GeoJSONFeatureCollection,
  boundaries: GeoJSONFeatureCollection,
): boolean {
  try {
    // Check if any feature in source intersects with boundaries
    for (const feature of sourceGeoJson.features) {
      if (!feature.geometry?.coordinates) {
        logger.warn("Skipping feature without valid geometry");
        continue;
      }

      if (checkFeatureIntersection(feature, boundaries)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.warn("Error checking boundaries intersection", { error: error instanceof Error ? error.message : String(error) });
    // In case of error, include the source to be safe
    return true;
  }
}
