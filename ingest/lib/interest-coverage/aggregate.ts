import {
  countBand,
  makeInterestCoverageGrid,
  INTEREST_GRID_METERS,
  INTEREST_METERS_PER_DEGREE,
  INTEREST_PRIVACY_MIN_USERS,
} from "@oboapp/shared";
import type { InterestCoverageReport } from "@oboapp/shared";

export function makeCoverageGrid(locality: string) {
  return makeInterestCoverageGrid(locality);
}

function parseZone(record: Record<string, unknown>) {
  const coordinates = record.coordinates;
  if (typeof record.userId !== "string" || !record.userId.trim() ||
      typeof coordinates !== "object" || coordinates === null ||
      !("lat" in coordinates) || !("lng" in coordinates)) return null;
  const { lat, lng } = coordinates;
  const radius = record.radius;
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
      typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      typeof radius !== "number" || !Number.isFinite(radius) || radius < 100 || radius > 1000) return null;
  return { userId: record.userId, lat, lng, radius };
}

/** Coarse circle/rectangle intersection in a local metric projection. */
function intersects(zone: NonNullable<ReturnType<typeof parseZone>>, cell: ReturnType<typeof makeCoverageGrid>["cells"][number], lngScale: number) {
  const nearestLat = Math.max(cell.south, Math.min(cell.north, zone.lat));
  const nearestLng = Math.max(cell.west, Math.min(cell.east, zone.lng));
  return Math.hypot((zone.lat - nearestLat) * INTEREST_METERS_PER_DEGREE, (zone.lng - nearestLng) * lngScale) <= zone.radius;
}

/**
 * A user's entire coarse spatial signature must be shared by >=10 users.
 * Suppressing whole signatures also protects sparse combinations of otherwise
 * populous cells. Unsafe contributors never enter published cell densities.
 */
export function aggregateInterestCoverage(records: Record<string, unknown>[], locality: string, generatedAt = new Date().toISOString()): InterestCoverageReport {
  const grid = makeCoverageGrid(locality);
  const users = new Map<string, Set<number>>();
  let interestCount = 0;
  for (const record of records) {
    const zone = parseZone(record);
    if (!zone) continue;
    const covered = grid.cells.flatMap((cell, index) => intersects(zone, cell, grid.lngScale) ? [index] : []);
    if (covered.length === 0) continue;
    interestCount++;
    const signature = users.get(zone.userId) ?? new Set<number>();
    covered.forEach((index) => signature.add(index));
    users.set(zone.userId, signature);
  }
  const base: InterestCoverageReport = {
    version: 1, locality, generatedAt, gridMeters: INTEREST_GRID_METERS,
    status: "unavailable", summary: null, cells: [],
  };
  if (users.size < INTEREST_PRIVACY_MIN_USERS) return base;

  const signatures = new Map<string, { cells: number[]; count: number }>();
  for (const covered of users.values()) {
    const cells = [...covered].sort((a, b) => a - b);
    const key = cells.join(",");
    const group = signatures.get(key) ?? { cells, count: 0 };
    group.count++;
    signatures.set(key, group);
  }
  const densities = new Map<number, number>();
  for (const group of signatures.values()) {
    if (group.count < INTEREST_PRIVACY_MIN_USERS) continue;
    for (const index of group.cells) densities.set(index, (densities.get(index) ?? 0) + group.count);
  }
  if (densities.size === 0) return base;
  return {
    ...base, status: "available",
    summary: { interests: countBand(interestCount), users: countBand(users.size) },
    cells: [...densities].map(([index, count]) => ({ ...grid.cells[index], users: countBand(count) })),
  };
}
