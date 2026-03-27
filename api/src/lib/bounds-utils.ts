/**
 * Geographic bounds and viewport utilities for the API package.
 * Forked from web/lib/bounds-utils.ts — uses @turf/turf for bbox calculations.
 */

import { bbox } from "@turf/turf";
import { getBoundsForLocality } from "@oboapp/shared";
import type { GeoJsonFeature } from "../schema/contract";

export interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

function getLocality(): string {
  return process.env.LOCALITY || "bg.sofia";
}

function getLocalityBounds() {
  return getBoundsForLocality(getLocality());
}

export function clampBounds(bounds: ViewportBounds): ViewportBounds {
  const localityBounds = getLocalityBounds();
  return {
    north: Math.min(bounds.north, localityBounds.north),
    south: Math.max(bounds.south, localityBounds.south),
    east: Math.min(bounds.east, localityBounds.east),
    west: Math.max(bounds.west, localityBounds.west),
  };
}

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

export function featureIntersectsBounds(
  feature: GeoJsonFeature,
  bounds: ViewportBounds,
): boolean {
  if (!feature.geometry?.coordinates) return false;

  try {
    // bbox() accepts any GeoJSON-like object at runtime
    const bboxResult = bbox(structuredClone(feature));

    const [minLng, minLat, maxLng, maxLat] = bboxResult;

    return !(
      maxLat < bounds.south ||
      minLat > bounds.north ||
      maxLng < bounds.west ||
      minLng > bounds.east
    );
  } catch {
    return false;
  }
}
