/**
 * Dynamic grid system for air quality monitoring.
 *
 * Divides a locality's bounding box into ~4km rectangular cells.
 * Cell count is determined naturally by the bounds extent — no hardcoded limit.
 */

import type { BoundsDefinition } from "@oboapp/shared";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import { CELL_SIZE_KM, KM_PER_DEGREE_LAT } from "./constants";

export interface GridCell {
  /** Grid cell identifier, e.g. "r2c3" (row 2, column 3) */
  id: string;
  /** Cell bounding box */
  bounds: BoundsDefinition;
  /** Cell center coordinates */
  center: { lat: number; lng: number };
  /** Cell polygon as GeoJSON FeatureCollection */
  geoJson: GeoJSONFeatureCollection;
}

/**
 * Build a rectangular grid over a locality's bounds.
 *
 * @param bounds - Locality bounding box (south, west, north, east)
 * @param cellSizeKm - Target cell size in km (default: ~4km)
 * @returns Array of grid cells covering the bounds
 */
export function buildGrid(
  bounds: BoundsDefinition,
  cellSizeKm: number = CELL_SIZE_KM,
): readonly GridCell[] {
  const centerLat = (bounds.south + bounds.north) / 2;
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);

  const latSpanKm = (bounds.north - bounds.south) * KM_PER_DEGREE_LAT;
  const lngSpanKm = (bounds.east - bounds.west) * kmPerDegreeLng;

  const rows = Math.ceil(latSpanKm / cellSizeKm);
  const cols = Math.ceil(lngSpanKm / cellSizeKm);

  const latStep = (bounds.north - bounds.south) / rows;
  const lngStep = (bounds.east - bounds.west) / cols;

  const cells: GridCell[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellSouth = bounds.south + r * latStep;
      const cellNorth = bounds.south + (r + 1) * latStep;
      const cellWest = bounds.west + c * lngStep;
      const cellEast = bounds.west + (c + 1) * lngStep;

      const cellBounds: BoundsDefinition = {
        south: cellSouth,
        north: cellNorth,
        west: cellWest,
        east: cellEast,
      };

      cells.push({
        id: `r${r}c${c}`,
        bounds: cellBounds,
        center: {
          lat: (cellSouth + cellNorth) / 2,
          lng: (cellWest + cellEast) / 2,
        },
        geoJson: cellToGeoJson(cellBounds),
      });
    }
  }

  return cells;
}

/**
 * Find which grid cell a coordinate falls into.
 * Returns null if the point is outside all cells.
 */
export function assignToGridCell(
  grid: readonly GridCell[],
  lat: number,
  lng: number,
): GridCell | null {
  for (const cell of grid) {
    if (
      lat >= cell.bounds.south &&
      lat <= cell.bounds.north &&
      lng >= cell.bounds.west &&
      lng <= cell.bounds.east
    ) {
      return cell;
    }
  }
  return null;
}

/**
 * Look up a grid cell by ID.
 */
export function getGridCellById(
  grid: readonly GridCell[],
  id: string,
): GridCell | null {
  return grid.find((cell) => cell.id === id) ?? null;
}

/**
 * Convert cell bounds to a GeoJSON FeatureCollection with a single Polygon feature.
 */
function cellToGeoJson(bounds: BoundsDefinition): GeoJSONFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [bounds.west, bounds.south],
              [bounds.east, bounds.south],
              [bounds.east, bounds.north],
              [bounds.west, bounds.north],
              [bounds.west, bounds.south], // close ring
            ],
          ],
        },
      },
    ],
  };
}
