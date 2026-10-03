import { getBoundsForLocality } from "./bounds";

export const INTEREST_GRID_METERS = 2000;
export const INTEREST_METERS_PER_DEGREE = 111320;

/** A fixed city grid. Projection is an approximation suitable for coarse reports. */
export function makeInterestCoverageGrid(locality: string) {
  const bounds = getBoundsForLocality(locality);
  const latitude = (bounds.south + bounds.north) / 2;
  const lngScale = INTEREST_METERS_PER_DEGREE * Math.cos(latitude * Math.PI / 180);
  const latStep = INTEREST_GRID_METERS / INTEREST_METERS_PER_DEGREE;
  const lngStep = INTEREST_GRID_METERS / lngScale;
  const cells: { south: number; west: number; north: number; east: number }[] = [];
  for (let south = bounds.south; south < bounds.north; south += latStep) {
    for (let west = bounds.west; west < bounds.east; west += lngStep) {
      cells.push({ south, west, north: Math.min(south + latStep, bounds.north), east: Math.min(west + lngStep, bounds.east) });
    }
  }
  return { cells, lngScale };
}
