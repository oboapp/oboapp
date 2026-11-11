/**
 * Geographic bounds and viewport utilities
 */

import * as turf from "@turf/turf";
import type { GeoJSONFeature } from "@/lib/types";
import {
  getBoundsForLocality,
  getCenterForLocality,
  roundCoordinate,
} from "@oboapp/shared";

/**
 * Get locality from environment variable
 * @throws Error if NEXT_PUBLIC_LOCALITY is not set
 */
export function getLocality(): string {
  const locality = process.env.NEXT_PUBLIC_LOCALITY;
  if (!locality) {
    throw new Error(
      "NEXT_PUBLIC_LOCALITY environment variable is required but not set",
    );
  }
  return locality;
}

/**
 * Get bounds for the configured locality
 */
export function getLocalityBounds() {
  const locality = getLocality();
  return getBoundsForLocality(locality);
}

/**
 * Get center for the configured locality
 */
export function getLocalityCenter() {
  const locality = getLocality();
  return getCenterForLocality(locality);
}

// Re-export BOUNDS for tests
export { BOUNDS } from "@oboapp/shared";

export interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom?: number; // Optional for backward compatibility
}

/** Read a ready map viewport with the coordinate precision used by event queries. */
export function getMapViewportBounds(
  map: Pick<google.maps.Map, "getBounds" | "getZoom"> | null,
): Required<ViewportBounds> | null {
  const bounds = map?.getBounds();
  const zoom = map?.getZoom();
  if (!bounds || zoom === undefined) {
    return null;
  }

  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  return {
    north: roundCoordinate(northEast.lat()),
    south: roundCoordinate(southWest.lat()),
    east: roundCoordinate(northEast.lng()),
    west: roundCoordinate(southWest.lng()),
    zoom,
  };
}

/**
 * Clamp viewport bounds to locality boundaries
 */
export function clampBounds(bounds: ViewportBounds): ViewportBounds {
  const localityBounds = getLocalityBounds();
  return {
    north: Math.min(bounds.north, localityBounds.north),
    south: Math.max(bounds.south, localityBounds.south),
    east: Math.min(bounds.east, localityBounds.east),
    west: Math.max(bounds.west, localityBounds.west),
  };
}

/**
 * Add percentage-based buffer to viewport bounds
 * @param bounds - Original viewport bounds
 * @param bufferPercent - Buffer percentage (e.g., 0.2 for 20%)
 * @returns Buffered bounds clamped to locality boundaries
 */
export function addBuffer(
  bounds: ViewportBounds,
  bufferPercent: number = 0.2,
): ViewportBounds {
  const localityBounds = getLocalityBounds();
  const latBuffer = (bounds.north - bounds.south) * bufferPercent;
  const lngBuffer = (bounds.east - bounds.west) * bufferPercent;

  return {
    north: Math.min(bounds.north + latBuffer, localityBounds.north),
    south: Math.max(bounds.south - latBuffer, localityBounds.south),
    east: Math.min(bounds.east + lngBuffer, localityBounds.east),
    west: Math.max(bounds.west - lngBuffer, localityBounds.west),
  };
}

/**
 * Check if a GeoJSON feature's bounding box intersects with viewport bounds
 */
export function featureIntersectsBounds(
  feature: GeoJSONFeature,
  bounds: ViewportBounds,
): boolean {
  if (!feature.geometry?.coordinates) return false;

  try {
    // Wrap geometry in a proper feature for Turf.js if needed
    const turfFeature =
      feature.type === "Feature" ? feature : turf.feature(feature.geometry);

    // Use Turf.js to calculate feature bounding box [minX, minY, maxX, maxY]
    const [minLng, minLat, maxLng, maxLat] = turf.bbox(turfFeature);

    // Check if bounding boxes overlap
    return !(
      (
        maxLat < bounds.south || // feature is completely below
        minLat > bounds.north || // feature is completely above
        maxLng < bounds.west || // feature is completely to the left
        minLng > bounds.east
      ) // feature is completely to the right
    );
  } catch (error) {
    // If bbox calculation fails, exclude the feature to be safe
    console.warn("⚠️  Failed to calculate feature bbox:", error);
    return false;
  }
}
