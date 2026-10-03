import { getBoundsForLocality } from "./bounds";

export const INTEREST_RASTER_METERS = 100;
export const INTEREST_JITTER_METERS = 200;
export const INTEREST_MIN_PIXEL_USERS = 3;
export const INTEREST_BLUR_METERS = 150;
export const INTEREST_HEATMAP_FULL_USERS = 20;
// Matches the web theme's blue / warning / error heatmap colors.
export const INTEREST_HEATMAP_COLORS = ["#4285F4", "#F59E0B", "#DC2626"];
const EARTH_RADIUS = 6378137;

export function projectInterestLocation(lat: number, lng: number) {
  return {
    x: EARTH_RADIUS * lng * Math.PI / 180,
    y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)),
  };
}

/** Fixed locality-wide Web Mercator raster, independent of individual zones. */
export function makeInterestRaster(locality: string) {
  const bounds = getBoundsForLocality(locality);
  const southWest = projectInterestLocation(bounds.south, bounds.west);
  const northEast = projectInterestLocation(bounds.north, bounds.east);
  const groundScale = Math.cos((bounds.south + bounds.north) / 2 * Math.PI / 180);
  const width = Math.ceil((northEast.x - southWest.x) * groundScale / INTEREST_RASTER_METERS);
  const height = Math.ceil((northEast.y - southWest.y) * groundScale / INTEREST_RASTER_METERS);
  if (width > 2048 || height > 2048) throw new Error("Interest raster exceeds supported locality size");
  return {
    bounds, width, height, groundScale,
    west: southWest.x, north: northEast.y,
    stepX: (northEast.x - southWest.x) / width,
    stepY: (northEast.y - southWest.y) / height,
  };
}
