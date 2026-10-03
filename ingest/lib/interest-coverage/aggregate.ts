import {
  countBand, getBoundsForLocality, makeInterestRaster, projectInterestLocation,
  INTEREST_METERS_PER_DEGREE, INTEREST_PRIVACY_MIN_USERS,
} from "@oboapp/shared";
import type { InterestCoverageImageReport } from "@oboapp/shared";
import { offsetInterestLocation, validateJitterSecret } from "./jitter";
import { renderInterestImage } from "./render";

function parseZone(record: Record<string, unknown>) {
  const coordinates = record.coordinates;
  if (typeof record.userId !== "string" || !record.userId.trim() ||
      typeof coordinates !== "object" || coordinates === null ||
      !("lat" in coordinates) || !("lng" in coordinates)) return null;
  const { lat, lng } = coordinates;
  const radius = record.radius;
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) >= 90 ||
      typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      typeof radius !== "number" || !Number.isFinite(radius) || radius < 100 || radius > 1000) return null;
  return { userId: record.userId, lat, lng, radius };
}

type Zone = NonNullable<ReturnType<typeof parseZone>>;

function intersectsLocality(zone: Zone, bounds: ReturnType<typeof getBoundsForLocality>) {
  const lat = Math.max(bounds.south, Math.min(bounds.north, zone.lat));
  const lng = Math.max(bounds.west, Math.min(bounds.east, zone.lng));
  return Math.hypot((zone.lat - lat) * INTEREST_METERS_PER_DEGREE,
    (zone.lng - lng) * INTEREST_METERS_PER_DEGREE * Math.cos(lat * Math.PI / 180)) <= zone.radius;
}

/** Add one person's union of shifted circles; repeated/overlapping zones count once. */
function addUserCoverage(zones: Zone[], counts: Uint32Array, raster: ReturnType<typeof makeInterestRaster>, locality: string, secret: string) {
  const covered = new Set<number>();
  for (const zone of zones) {
    const shifted = offsetInterestLocation(zone.userId, locality, zone.lat, zone.lng, secret);
    const center = projectInterestLocation(shifted.lat, shifted.lng);
    const radius = zone.radius / raster.groundScale;
    const left = Math.max(0, Math.floor((center.x - radius - raster.west) / raster.stepX));
    const right = Math.min(raster.width, Math.ceil((center.x + radius - raster.west) / raster.stepX));
    const top = Math.max(0, Math.floor((raster.north - center.y - radius) / raster.stepY));
    const bottom = Math.min(raster.height, Math.ceil((raster.north - center.y + radius) / raster.stepY));
    for (let row = top; row < bottom; row++) {
      for (let column = left; column < right; column++) {
        const x = raster.west + (column + 0.5) * raster.stepX;
        const y = raster.north - (row + 0.5) * raster.stepY;
        if (Math.hypot(x - center.x, y - center.y) <= radius) covered.add(row * raster.width + column);
      }
    }
  }
  for (const index of covered) counts[index]++;
}

export function aggregateInterestCoverage(records: Record<string, unknown>[], locality: string, secret: string, generatedAt = new Date().toISOString()): InterestCoverageImageReport {
  validateJitterSecret(secret);
  const raster = makeInterestRaster(locality);
  const users = new Map<string, Zone[]>();
  let interestCount = 0;
  for (const record of records) {
    const zone = parseZone(record);
    if (!zone || !intersectsLocality(zone, raster.bounds)) continue;
    interestCount++;
    const zones = users.get(zone.userId) ?? [];
    zones.push(zone);
    users.set(zone.userId, zones);
  }
  const base: InterestCoverageImageReport = {
    version: 2, locality, generatedAt, status: "unavailable", summary: null, image: null,
  };
  if (users.size < INTEREST_PRIVACY_MIN_USERS) return base;
  const counts = new Uint32Array(raster.width * raster.height);
  for (const zones of users.values()) addUserCoverage(zones, counts, raster, locality, secret);
  const image = renderInterestImage(counts, raster.width, raster.height);
  if (!image) return base;
  return {
    ...base, status: "available", image,
    summary: { interests: countBand(interestCount), users: countBand(users.size) },
  };
}
