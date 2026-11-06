import { destination } from "@turf/turf";
import { describe, expect, it } from "vitest";
import type { Interest } from "@/lib/types";
import { getZoneBounds } from "./zone-bounds";

type Zone = Pick<Interest, "coordinates" | "radius">;

const home: Zone = {
  coordinates: { lat: 42.6977, lng: 23.3219 },
  radius: 500,
};

function expectCircleContained(zone: Zone) {
  const bounds = getZoneBounds([zone]);
  expect(bounds).not.toBeNull();

  if (!bounds) {
    throw new Error("Expected zone bounds");
  }

  for (let bearing = 0; bearing < 360; bearing += 5) {
    const point = destination(
      [zone.coordinates.lng, zone.coordinates.lat],
      zone.radius,
      bearing,
      { units: "meters" },
    );
    const [lng, lat] = point.geometry.coordinates;
    expect(lat).toBeLessThanOrEqual(bounds.north + 1e-10);
    expect(lat).toBeGreaterThanOrEqual(bounds.south - 1e-10);

    if (bounds.west > bounds.east) {
      expect(lng >= bounds.west - 1e-10 || lng <= bounds.east + 1e-10).toBe(true);
    } else {
      expect(lng).toBeGreaterThanOrEqual(bounds.west - 1e-10);
      expect(lng).toBeLessThanOrEqual(bounds.east + 1e-10);
    }
  }
}

describe("getZoneBounds", () => {
  it("returns no bounds for an empty zone list", () => {
    expect(getZoneBounds([])).toBeNull();
  });

  it("contains the complete circle of a single zone", () => {
    expectCircleContained(home);
    const bounds = getZoneBounds([home]);
    expect(bounds?.north).toBeCloseTo(42.7021966, 6);
    expect(bounds?.south).toBeCloseTo(42.6932034, 6);
    expect(bounds?.west).toBeCloseTo(23.3157825, 5);
    expect(bounds?.east).toBeCloseTo(23.3280175, 5);
  });

  it("uses the outer circle when zones share a center with different radii", () => {
    const widerZone = { ...home, radius: 1000 };
    expect(getZoneBounds([home, widerZone])).toEqual(getZoneBounds([widerZone]));
  });

  it("unions overlapping circles and retains their outer edges", () => {
    const nearbyZone: Zone = {
      coordinates: { lat: 42.7, lng: 23.325 },
      radius: 1000,
    };
    const first = getZoneBounds([home])!;
    const second = getZoneBounds([nearbyZone])!;

    expect(getZoneBounds([home, nearbyZone])).toEqual({
      north: Math.max(first.north, second.north),
      south: Math.min(first.south, second.south),
      east: Math.max(first.east, second.east),
      west: Math.min(first.west, second.west),
    });
  });

  it("includes widely separated circles without relying on event data", () => {
    const distantZone: Zone = {
      coordinates: { lat: 43.2141, lng: 27.9147 },
      radius: 1000,
    };
    const first = getZoneBounds([home])!;
    const second = getZoneBounds([distantZone])!;

    expect(getZoneBounds([home, distantZone])).toEqual({
      north: second.north,
      south: first.south,
      west: first.west,
      east: second.east,
    });
  });

  it("returns narrow bounds for circles crossing the date line", () => {
    const zone: Zone = {
      coordinates: { lat: 10, lng: 179.999 },
      radius: 1000,
    };
    expectCircleContained(zone);
    const bounds = getZoneBounds([zone])!;
    expect(bounds.west).toBeGreaterThan(179.98);
    expect(bounds.east).toBeLessThan(-179.98);
  });

  it("unions zones on opposite sides of the date line", () => {
    const zones: Zone[] = [
      { coordinates: { lat: 10, lng: 179.95 }, radius: 100 },
      { coordinates: { lat: 10, lng: -179.95 }, radius: 1000 },
    ];
    const bounds = getZoneBounds(zones)!;
    expect(bounds.west).toBeGreaterThan(179.94);
    expect(bounds.east).toBeLessThan(-179.94);
    expect(getZoneBounds([...zones].reverse())).toEqual(bounds);
  });

  it("uses full longitude bounds for a circle containing a pole", () => {
    const zone: Zone = {
      coordinates: { lat: 89.999, lng: 0 },
      radius: 1000,
    };
    expectCircleContained(zone);
    expect(getZoneBounds([zone])).toEqual({
      north: 90,
      south: expect.closeTo(89.9900068, 6),
      west: -180,
      east: 180,
    });
  });

  it("skips invalid coordinates and radii", () => {
    const invalidZones: Zone[] = [
      { ...home, radius: 0 },
      { ...home, radius: -1 },
      { ...home, radius: Number.NaN },
      { ...home, radius: Number.POSITIVE_INFINITY },
      { ...home, coordinates: { lat: 91, lng: 23 } },
      { ...home, coordinates: { lat: 42, lng: 181 } },
      { ...home, coordinates: { lat: Number.NaN, lng: 23 } },
    ];

    expect(getZoneBounds(invalidZones)).toBeNull();
    expect(getZoneBounds([...invalidZones, home])).toEqual(getZoneBounds([home]));
  });
});
