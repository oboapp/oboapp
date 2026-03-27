import { describe, it, expect, beforeEach } from "vitest";
import {
  BOUNDS,
  getLocalityBounds,
  getLocalityCenter,
  clampBounds,
  addBuffer,
  featureIntersectsBounds,
  type ViewportBounds,
} from "./bounds-utils";

// Set environment variable for tests
beforeEach(() => {
  process.env.NEXT_PUBLIC_LOCALITY = "bg.sofia";
});

const TEST_BOUNDS = BOUNDS["bg.sofia"];

describe("bounds-utils", () => {
  describe("BOUNDS registry", () => {
    it("should have correct Sofia boundaries", () => {
      expect(TEST_BOUNDS).toEqual({
        south: 42.605,
        west: 23.188,
        north: 42.83,
        east: 23.528,
      });
    });
  });

  describe("getLocalityBounds", () => {
    it("should return bounds for the configured locality", () => {
      const bounds = getLocalityBounds();
      expect(bounds).toEqual(TEST_BOUNDS);
    });

    it("should throw error if environment variable not set", () => {
      delete process.env.NEXT_PUBLIC_LOCALITY;
      expect(() => getLocalityBounds()).toThrow("NEXT_PUBLIC_LOCALITY environment variable is required but not set");
    });
  });

  describe("getLocalityCenter", () => {
    it("should return center for the configured locality", () => {
      const center = getLocalityCenter();
      expect(center).toEqual({ lat: 42.6977, lng: 23.3219 });
    });

    it("should throw error if environment variable not set", () => {
      delete process.env.NEXT_PUBLIC_LOCALITY;
      expect(() => getLocalityCenter()).toThrow("NEXT_PUBLIC_LOCALITY environment variable is required but not set");
    });
  });

  describe("clampBounds", () => {
    it("should not modify bounds already within locality", () => {
      const bounds: ViewportBounds = {
        north: 42.7,
        south: 42.65,
        east: 23.4,
        west: 23.3,
      };

      const clamped = clampBounds(bounds);

      expect(clamped).toEqual(bounds);
    });

    it("should clamp north boundary if too far north", () => {
      const bounds: ViewportBounds = {
        north: 43.0, // Beyond Sofia
        south: 42.7,
        east: 23.4,
        west: 23.3,
      };

      const clamped = clampBounds(bounds);

      expect(clamped.north).toBe(TEST_BOUNDS.north);
      expect(clamped.south).toBe(bounds.south);
    });

    it("should clamp south boundary if too far south", () => {
      const bounds: ViewportBounds = {
        north: 42.7,
        south: 42.5, // Beyond Sofia
        east: 23.4,
        west: 23.3,
      };

      const clamped = clampBounds(bounds);

      expect(clamped.south).toBe(TEST_BOUNDS.south);
      expect(clamped.north).toBe(bounds.north);
    });

    it("should clamp east boundary if too far east", () => {
      const bounds: ViewportBounds = {
        north: 42.7,
        south: 42.65,
        east: 23.6, // Beyond Sofia
        west: 23.3,
      };

      const clamped = clampBounds(bounds);

      expect(clamped.east).toBe(TEST_BOUNDS.east);
      expect(clamped.west).toBe(bounds.west);
    });

    it("should clamp west boundary if too far west", () => {
      const bounds: ViewportBounds = {
        north: 42.7,
        south: 42.65,
        east: 23.4,
        west: 23.1, // Beyond Sofia
      };

      const clamped = clampBounds(bounds);

      expect(clamped.west).toBe(TEST_BOUNDS.west);
      expect(clamped.east).toBe(bounds.east);
    });

    it("should clamp all boundaries if completely outside Sofia", () => {
      const bounds: ViewportBounds = {
        north: 45.0,
        south: 44.0,
        east: 25.0,
        west: 24.0,
      };

      const clamped = clampBounds(bounds);

      // When completely outside, south clamps up and north clamps down
      // This results in inverted bounds (south > north)
      expect(clamped.north).toBe(TEST_BOUNDS.north);
      expect(clamped.south).toBe(44.0); // Can't clamp below original
      expect(clamped.east).toBe(TEST_BOUNDS.east);
      expect(clamped.west).toBe(24.0); // Can't clamp below original
    });
  });

  describe("addBuffer", () => {
    it("should add 20% buffer by default", () => {
      const bounds: ViewportBounds = {
        north: 42.7,
        south: 42.65, // 0.05 lat range
        east: 23.4,
        west: 23.35, // 0.05 lng range
      };

      const buffered = addBuffer(bounds);

      // 20% of 0.05 = 0.01
      expect(buffered.north).toBeCloseTo(42.71, 5);
      expect(buffered.south).toBeCloseTo(42.64, 5);
      expect(buffered.east).toBeCloseTo(23.41, 5);
      expect(buffered.west).toBeCloseTo(23.34, 5);
    });

    it("should add custom buffer percentage", () => {
      const bounds: ViewportBounds = {
        north: 42.7,
        south: 42.65, // 0.05 lat range
        east: 23.4,
        west: 23.35, // 0.05 lng range
      };

      const buffered = addBuffer(bounds, 0.1); // 10% buffer

      // 10% of 0.05 = 0.005
      expect(buffered.north).toBeCloseTo(42.705, 5);
      expect(buffered.south).toBeCloseTo(42.645, 5);
      expect(buffered.east).toBeCloseTo(23.405, 5);
      expect(buffered.west).toBeCloseTo(23.345, 5);
    });

    it("should clamp buffered bounds to Sofia boundaries", () => {
      const bounds: ViewportBounds = {
        north: 42.82, // Very close to Sofia north boundary
        south: 42.72,
        east: 23.52, // Very close to Sofia east boundary
        west: 23.42,
      };

      const buffered = addBuffer(bounds, 0.2);

      // Should not exceed locality bounds
      expect(buffered.north).toBeLessThanOrEqual(TEST_BOUNDS.north);
      expect(buffered.south).toBeGreaterThanOrEqual(TEST_BOUNDS.south);
      expect(buffered.east).toBeLessThanOrEqual(TEST_BOUNDS.east);
      expect(buffered.west).toBeGreaterThanOrEqual(TEST_BOUNDS.west);
    });
  });

  describe("featureIntersectsBounds", () => {
    const viewportBounds: ViewportBounds = {
      north: 42.7,
      south: 42.65,
      east: 23.35,
      west: 23.3,
    };

    it("should return true for Point inside bounds", () => {
      const pointFeature = {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [23.32, 42.68] as [number, number], // [lng, lat] inside viewport
        },
        properties: {},
      };

      expect(featureIntersectsBounds(pointFeature, viewportBounds)).toBe(true);
    });

    it("should return false for Point outside bounds", () => {
      const pointFeature = {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [23.4, 42.8] as [number, number], // [lng, lat] outside viewport
        },
        properties: {},
      };

      expect(featureIntersectsBounds(pointFeature, viewportBounds)).toBe(false);
    });

    it("should return true for LineString intersecting bounds", () => {
      const lineFeature = {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [23.25, 42.6], // Outside (west)
            [23.32, 42.68], // Inside
            [23.4, 42.75], // Outside (east)
          ] as [number, number][],
        },
        properties: {},
      };

      expect(featureIntersectsBounds(lineFeature, viewportBounds)).toBe(true);
    });

    it("should return false for LineString completely outside bounds", () => {
      const lineFeature = {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [23.4, 42.8],
            [23.45, 42.85],
          ] as [number, number][],
        },
        properties: {},
      };

      expect(featureIntersectsBounds(lineFeature, viewportBounds)).toBe(false);
    });

    it("should return true for Polygon intersecting bounds", () => {
      const polygonFeature = {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [23.29, 42.64], // SW corner (overlaps)
              [23.36, 42.64], // SE corner (overlaps)
              [23.36, 42.71], // NE corner (overlaps)
              [23.29, 42.71], // NW corner (overlaps)
              [23.29, 42.64], // Close the ring
            ],
          ] as [number, number][][],
        },
        properties: {},
      };

      expect(featureIntersectsBounds(polygonFeature, viewportBounds)).toBe(
        true,
      );
    });

    it("should return false for Polygon completely outside bounds", () => {
      const polygonFeature = {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [23.5, 42.8],
              [23.6, 42.8],
              [23.6, 42.9],
              [23.5, 42.9],
              [23.5, 42.8],
            ],
          ] as [number, number][][],
        },
        properties: {},
      };

      expect(featureIntersectsBounds(polygonFeature, viewportBounds)).toBe(
        false,
      );
    });

    it("should return false for feature without coordinates", () => {
      const invalidFeature = {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
        },
        properties: {},
      } as any;

      expect(featureIntersectsBounds(invalidFeature, viewportBounds)).toBe(
        false,
      );
    });

    it("should return false for feature without geometry", () => {
      const invalidFeature = {
        type: "Feature",
        properties: {},
      } as any;

      expect(featureIntersectsBounds(invalidFeature, viewportBounds)).toBe(
        false,
      );
    });

    it("should handle Point at viewport boundary as intersecting", () => {
      const pointFeature = {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [23.3, 42.65] as [number, number], // Exactly on boundary
        },
        properties: {},
      };

      expect(featureIntersectsBounds(pointFeature, viewportBounds)).toBe(true);
    });

    it("should include Polygon partially overlapping viewport edge", () => {
      // Polygon extends from inside to outside the viewport (partially inside)
      const partialOverlapFeature = {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [23.34, 42.69], // Inside viewport
              [23.38, 42.69], // Outside viewport (east of 23.35)
              [23.38, 42.72], // Outside viewport
              [23.34, 42.72], // Outside viewport (north of 42.7)
              [23.34, 42.69], // Close the ring
            ],
          ] as [number, number][][],
        },
        properties: {},
      };

      expect(
        featureIntersectsBounds(partialOverlapFeature, viewportBounds),
      ).toBe(true);
    });

    it("should include LineString touching viewport boundary edge", () => {
      // LineString that runs along the south boundary edge
      const edgeLineFeature = {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [23.31, 42.65], // On south boundary
            [23.34, 42.65], // On south boundary
          ] as [number, number][],
        },
        properties: {},
      };

      expect(featureIntersectsBounds(edgeLineFeature, viewportBounds)).toBe(
        true,
      );
    });
  });
});
