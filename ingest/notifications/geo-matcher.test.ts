import { describe, it, expect } from "vitest";
import { matchMessageToInterest } from "./geo-matcher";
import type { Message, Interest, GeoJSONFeatureCollection } from "@/lib/types";

describe("geo-matcher", () => {
  describe("matchMessageToInterest", () => {
    const baseInterest: Interest = {
      id: "int1",
      userId: "user1",
      coordinates: { lat: 42.6977, lng: 23.3219 }, // Sofia center
      radius: 1000, // 1km
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    it("should match when point is within interest radius", () => {
      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [23.3219, 42.6977], // Same as interest center
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(true);
      expect(result.distance).toBeLessThan(10); // Very close to center
    });

    it("should not match when point is outside interest radius", () => {
      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [23.4, 42.75], // ~10km away
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(false);
      expect(result.distance).toBeNull();
    });

    it("should match LineString that intersects interest circle", () => {
      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [23.32, 42.697], // Near interest center
                [23.325, 42.698],
              ],
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(true);
      expect(result.distance).toBeLessThan(1000);
    });

    it("should match Polygon that intersects interest circle", () => {
      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [23.32, 42.697],
                  [23.325, 42.697],
                  [23.325, 42.698],
                  [23.32, 42.698],
                  [23.32, 42.697],
                ],
              ],
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(true);
      expect(result.distance).toBeLessThan(1000);
    });

    it("should return smallest distance when multiple features match", () => {
      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [23.328, 42.697], // ~500m away
            },
          },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [23.3219, 42.6977], // At center
            },
          },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [23.33, 42.698], // ~800m away
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(true);
      expect(result.distance).toBeLessThan(10); // Should pick the closest one
    });

    it("should not match when geoJson is undefined", () => {
      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson: undefined,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(false);
      expect(result.distance).toBeNull();
    });

    it("should not match when geoJson has no features", () => {
      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson: {
          type: "FeatureCollection",
          features: [],
        },
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(false);
      expect(result.distance).toBeNull();
    });

    it("should use sofia.geojson for city-wide messages", () => {
      // City-wide message should match any interest in Sofia
      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "City-wide alert",
        aiProcessed: false,
        cityWide: true,
        geoJson: {
          // This GeoJSON will be ignored, sofia.geojson will be used instead
          type: "FeatureCollection",
          features: [],
        },
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      // Should match because interest is in Sofia and message is city-wide
      expect(result.matches).toBe(true);
      expect(result.distance).toBeGreaterThan(0);
    });

    it("should handle larger radius", () => {
      const largeRadiusInterest: Interest = {
        ...baseInterest,
        radius: 5000, // 5km radius
      };

      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [23.35, 42.71], // ~3km away
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, largeRadiusInterest);

      expect(result.matches).toBe(true);
      expect(result.distance).toBeGreaterThan(2000);
      expect(result.distance).toBeLessThan(5000);
    });

    it("should calculate distance for Polygon using centroid", () => {
      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [23.325, 42.697],
                  [23.33, 42.697],
                  [23.33, 42.7],
                  [23.325, 42.7],
                  [23.325, 42.697],
                ],
              ],
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      expect(result.matches).toBe(true);
      // Distance should be to centroid of polygon
      expect(result.distance).toBeGreaterThan(0);
    });

    it("should handle malformed features gracefully", () => {
      const geoJson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [23.3219, 42.6977],
            },
          },
          // This will be skipped due to error handling
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point" as const,
              coordinates: [] as unknown as [number, number], // Malformed
            },
          },
        ],
      };

      const message: Message = {
        locality: "bg.sofia",
        id: "msg1",
        text: "Test",
        aiProcessed: false,
        geoJson,
        createdAt: "2026-02-01T00:00:00.000Z",
      };

      const result = matchMessageToInterest(message, baseInterest);

      // Should still match due to first valid feature
      expect(result.matches).toBe(true);
      expect(result.distance).toBeLessThan(10);
    });
  });
});
