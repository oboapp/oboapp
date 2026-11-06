import { earthRadius } from "@turf/helpers";
import type { ViewportBounds } from "@/lib/bounds-utils";
import type { Interest } from "@/lib/types";

type Zone = Pick<Interest, "coordinates" | "radius">;
type LongitudeInterval = { start: number; end: number };

const DEGREES_PER_RADIAN = 180 / Math.PI;
const HALF_CIRCLE = 180;
const FULL_CIRCLE = 360;

function getLongitudeIntervals(
  longitude: number,
  longitudeRadius: number,
): LongitudeInterval[] {
  // Shift longitudes to [0, 360] so intervals crossing the date line can be split.
  const west = longitude + HALF_CIRCLE - longitudeRadius;
  const start = ((west % FULL_CIRCLE) + FULL_CIRCLE) % FULL_CIRCLE;
  const end = start + longitudeRadius * 2;

  if (end <= FULL_CIRCLE) {
    return [{ start, end }];
  }

  return [
    { start, end: FULL_CIRCLE },
    { start: 0, end: end - FULL_CIRCLE },
  ];
}

function getLongitudeBounds(
  intervals: LongitudeInterval[],
): Pick<ViewportBounds, "west" | "east"> {
  const sorted = intervals.toSorted((left, right) => {
    return left.start - right.start;
  });
  const merged: LongitudeInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  // Exclude the largest uncovered longitude gap to obtain the smallest bounds.
  let largestGap = 0;
  let west = -HALF_CIRCLE;
  let east = HALF_CIRCLE;

  for (const [index, interval] of merged.entries()) {
    const next = merged[(index + 1) % merged.length];
    const nextStart = next.start + (index === merged.length - 1 ? FULL_CIRCLE : 0);
    const gap = nextStart - interval.end;

    if (gap > largestGap) {
      largestGap = gap;
      west = next.start - HALF_CIRCLE;
      east = interval.end - HALF_CIRCLE;
    }
  }

  return { west, east };
}

/** Calculate bounds containing the full spherical circle of every valid zone. */
export function getZoneBounds(zones: readonly Zone[]): ViewportBounds | null {
  let north = -90;
  let south = 90;
  let hasValidZone = false;
  let coversAllLongitudes = false;
  const longitudeIntervals: LongitudeInterval[] = [];

  for (const zone of zones) {
    const { lat, lng } = zone.coordinates;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > HALF_CIRCLE ||
      !Number.isFinite(zone.radius) ||
      zone.radius <= 0
    ) {
      continue;
    }

    hasValidZone = true;
    const latitude = lat / DEGREES_PER_RADIAN;
    const angularRadius = Math.min(zone.radius / earthRadius, Math.PI);
    const latitudeRadius = angularRadius * DEGREES_PER_RADIAN;
    north = Math.max(north, Math.min(90, lat + latitudeRadius));
    south = Math.min(south, Math.max(-90, lat - latitudeRadius));

    if (angularRadius >= Math.PI / 2 - Math.abs(latitude)) {
      coversAllLongitudes = true;
      continue;
    }

    const longitudeRadius =
      Math.asin(Math.sin(angularRadius) / Math.cos(latitude)) *
      DEGREES_PER_RADIAN;
    longitudeIntervals.push(...getLongitudeIntervals(lng, longitudeRadius));
  }

  if (!hasValidZone) {
    return null;
  }

  const longitudeBounds = coversAllLongitudes
    ? { west: -HALF_CIRCLE, east: HALF_CIRCLE }
    : getLongitudeBounds(longitudeIntervals);

  return { north, south, ...longitudeBounds };
}
