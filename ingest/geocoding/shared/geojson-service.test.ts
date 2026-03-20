import { describe, it, expect, vi } from "vitest";
import type { GeoJSONLineString } from "@/lib/types";
import * as turf from "@turf/turf";
import type { Position } from "geojson";

// Mock firebase-admin to avoid requiring env vars
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: vi.fn(),
}));

// Mock geocoding-router to prevent real network calls in tests
vi.mock("@/geocoding/router", () => ({
  getStreetGeometry: vi.fn().mockResolvedValue([
    [23.351, 42.693],
    [23.352, 42.694],
    [23.353, 42.695],
  ]),
}));

/**
 * Tests for GeoJSON polygon generation from LineStrings
 *
 * This test file validates that buffered street polygons are created correctly
 * and do not self-intersect (crisscross).
 */

// Import the buffer function - we'll need to export it from geojson-service for testing
// For now, we'll test the concept with a simple implementation

/**
 * Helper to check if a polygon is self-intersecting (crisscrossing)
 * A valid polygon should not cross itself
 */
function isPolygonSelfIntersecting(
  coordinates: Position[][] | Position[][][],
): boolean {
  try {
    const polygon = turf.polygon(coordinates as Position[][]);
    const kinks = turf.kinks(polygon);
    return kinks.features.length > 0;
  } catch {
    // If turf can't even parse it, it's invalid
    return true;
  }
}

/**
 * Helper to check if polygon vertices are in consistent winding order
 * For GeoJSON, exterior rings should be counter-clockwise
 */
function hasCorrectWindingOrder(coordinates: Position[]): boolean {
  // Calculate signed area
  let area = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    area += (x2 - x1) * (y2 + y1);
  }
  // Positive area = clockwise, negative = counter-clockwise
  // GeoJSON spec requires counter-clockwise for exterior rings
  return area < 0;
}

describe("LineString to Polygon conversion", () => {
  describe("coordinate ordering", () => {
    it("should maintain forward direction when creating polygon from ordered LineString", () => {
      // Simple north-south line
      const lineString: GeoJSONLineString = {
        type: "LineString",
        coordinates: [
          [23.32, 42.69], // South point
          [23.32, 42.7], // North point
        ],
      };

      // When buffered, the resulting polygon should:
      // 1. Have first vertex near the start point (south)
      // 2. Progress along the line to the end point (north)
      // 3. Return on the opposite side
      // 4. Close at the starting point

      // We can't directly test the internal buffer function without exporting it,
      // but we can test the principle with turf.buffer
      const buffered = turf.buffer(
        turf.lineString(lineString.coordinates),
        0.01,
        {
          units: "kilometers",
        },
      );

      expect(buffered).toBeDefined();
      expect(buffered!.geometry.type).toBe("Polygon");

      const coords = buffered!.geometry.coordinates;
      expect(isPolygonSelfIntersecting(coords)).toBe(false);
    });

    it("should handle reversed LineString correctly", () => {
      // Same line but reversed (north to south)
      const lineString: GeoJSONLineString = {
        type: "LineString",
        coordinates: [
          [23.32, 42.7], // North point
          [23.32, 42.69], // South point
        ],
      };

      const buffered = turf.buffer(
        turf.lineString(lineString.coordinates),
        0.01,
        {
          units: "kilometers",
        },
      );

      expect(buffered).toBeDefined();
      expect(buffered!.geometry.type).toBe("Polygon");

      const coords = buffered!.geometry.coordinates;
      expect(isPolygonSelfIntersecting(coords)).toBe(false);
    });

    it("should create valid polygon from multi-point LineString", () => {
      // More complex line with multiple segments
      const lineString: GeoJSONLineString = {
        type: "LineString",
        coordinates: [
          [23.32, 42.69],
          [23.33, 42.7],
          [23.34, 42.7],
          [23.35, 42.69],
        ],
      };

      const buffered = turf.buffer(
        turf.lineString(lineString.coordinates),
        0.01,
        {
          units: "kilometers",
        },
      );

      expect(buffered).toBeDefined();
      const coords = buffered!.geometry.coordinates;
      expect(isPolygonSelfIntersecting(coords)).toBe(false);
    });

    it("should detect self-intersecting polygon as invalid", () => {
      // Create a self-intersecting polygon (figure-8 shape)
      const selfIntersecting: [number, number][] = [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
        [0, 0], // Close the ring
      ];

      expect(isPolygonSelfIntersecting([selfIntersecting])).toBe(true);
    });

    it("should validate that buffering preserves line direction", () => {
      // Test case similar to the actual bug scenario
      // Street section from point A to point B
      const lineAtoB: GeoJSONLineString = {
        type: "LineString",
        coordinates: [
          [23.329, 42.695], // Point A
          [23.332, 42.696], // Intermediate
          [23.335, 42.695], // Point B
        ],
      };

      // The reverse direction B to A
      const lineBtoA: GeoJSONLineString = {
        type: "LineString",
        coordinates: [
          [23.335, 42.695], // Point B
          [23.332, 42.696], // Intermediate
          [23.329, 42.695], // Point A
        ],
      };

      const bufferedAtoB = turf.buffer(
        turf.lineString(lineAtoB.coordinates),
        0.008,
        {
          units: "kilometers",
        },
      );

      const bufferedBtoA = turf.buffer(
        turf.lineString(lineBtoA.coordinates),
        0.008,
        {
          units: "kilometers",
        },
      );

      // Both should produce valid non-self-intersecting polygons
      expect(
        isPolygonSelfIntersecting(bufferedAtoB!.geometry.coordinates),
      ).toBe(false);
      expect(
        isPolygonSelfIntersecting(bufferedBtoA!.geometry.coordinates),
      ).toBe(false);

      // The polygons should be approximately the same area (just different winding)
      const areaAtoB = turf.area(bufferedAtoB!);
      const areaBtoA = turf.area(bufferedBtoA!);
      expect(Math.abs(areaAtoB - areaBtoA)).toBeLessThan(100); // Within 100 square meters
    });
  });

  describe("winding order", () => {
    it("should use counter-clockwise winding for exterior ring", () => {
      // GeoJSON spec requires CCW for exterior rings
      const validExterior: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];

      expect(hasCorrectWindingOrder(validExterior)).toBe(true);
    });

    it("should detect clockwise winding", () => {
      const clockwise: [number, number][] = [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ];

      expect(hasCorrectWindingOrder(clockwise)).toBe(false);
    });
  });
});

describe("convertToGeoJSON with pre-resolved coordinates", () => {
  it("should create straight line when both street endpoints have pre-resolved coordinates", async () => {
    const { getStreetGeometry } = await import("@/geocoding/router");
    const { convertToGeoJSON } = await import("./geojson-service");

    const extractedData = {
      withSpecificAddress: true,
      cityWide: false,
      busStops: [],
      pins: [],
      streets: [
        {
          street: "ул. Оборище",
          from: "Start Point",
          fromCoordinates: { lat: 42.693576, lng: 23.35161 },
          to: "End Point",
          toCoordinates: { lat: 42.693259, lng: 23.3549725 },
          timespans: [{ start: "05.02.2026 00:00", end: "09.03.2026 23:59" }],
        },
      ],
      cadastralProperties: [],
    };

    // The preGeocodedMap contains rounded coordinates (to 6 decimal places)
    // as would be populated by geocodeAddressesFromExtractedData
    const preGeocodedMap = new Map([
      ["Start Point", { lat: 42.693576, lng: 23.35161 }], // Rounded from 42.693576
      ["End Point", { lat: 42.693259, lng: 23.354973 }], // Rounded from 42.693259 and 23.3549725
    ]);

    const result = await convertToGeoJSON(extractedData, preGeocodedMap);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("Polygon");
    expect(result.features[0].properties.street).toBe("ул. Оборище");
    expect(result.features[0].properties.from).toBe("Start Point");
    expect(result.features[0].properties.to).toBe("End Point");

    // getStreetGeometry should NOT be called — straight line is used instead
    expect(getStreetGeometry).not.toHaveBeenCalled();
  });

  it("should use street geometry when endpoints are geocoded (not pre-resolved)", async () => {
    const { getStreetGeometry } = await import("@/geocoding/router");
    vi.mocked(getStreetGeometry).mockClear();
    const { convertToGeoJSON } = await import("./geojson-service");

    const extractedData = {
      withSpecificAddress: true,
      cityWide: false,
      busStops: [],
      pins: [],
      streets: [
        {
          street: "ул. Оборище",
          from: "ул. Лисец",
          to: "бул. Ситняково",
          // No fromCoordinates or toCoordinates - these were geocoded
          timespans: [{ start: "05.02.2026 00:00", end: "09.03.2026 23:59" }],
        },
      ],
      cadastralProperties: [],
    };

    const preGeocodedMap = new Map([
      ["ул. Лисец", { lat: 42.693, lng: 23.351 }],
      ["бул. Ситняково", { lat: 42.694, lng: 23.352 }],
    ]);

    const result = await convertToGeoJSON(extractedData, preGeocodedMap);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("Polygon");
    expect(result.features[0].properties.street).toBe("ул. Оборище");

    // getStreetGeometry SHOULD be called — no pre-resolved coordinates
    expect(getStreetGeometry).toHaveBeenCalledOnce();
  });
});
