/**
 * Geometry utilities for the API package.
 * Forked from web/lib/geometry-utils.ts — centroid calculation using @turf.
 */

import center from "@turf/center";
import { lineString, polygon } from "@turf/helpers";

interface Geometry {
  type: string;
  coordinates: unknown;
}

function toLatLng(coord: number[]): { lat: number; lng: number } {
  return { lat: coord[1], lng: coord[0] };
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === "number");
}

function isNumberArrayArray(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length > 0 && value.every(isNumberArray);
}

function isNumberArrayArrayArray(value: unknown): value is number[][][] {
  return (
    Array.isArray(value) && value.length > 0 && value.every(isNumberArrayArray)
  );
}

export function getCentroid(
  geometry: Geometry,
): { lat: number; lng: number } | null {
  if (!geometry?.type) return null;

  try {
    switch (geometry.type) {
      case "Point": {
        if (!isNumberArray(geometry.coordinates)) return null;
        return toLatLng(geometry.coordinates);
      }
      case "LineString": {
        if (!isNumberArrayArray(geometry.coordinates)) return null;
        const turfLine = lineString(geometry.coordinates);
        const c = center(turfLine);
        return toLatLng(c.geometry.coordinates);
      }
      case "Polygon": {
        if (!isNumberArrayArrayArray(geometry.coordinates)) return null;
        const turfPoly = polygon(geometry.coordinates);
        const c = center(turfPoly);
        return toLatLng(c.geometry.coordinates);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
