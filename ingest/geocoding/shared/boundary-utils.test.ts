import { describe, it, expect } from "vitest";
import {
  filterFeaturesByBoundaries,
  isWithinBoundaries,
} from "./boundary-utils";
import type { GeoJSONFeatureCollection } from "../../lib/types";

describe("boundary-utils", () => {
  // Simple square boundary in Sofia (roughly around Oborishte)
  const testBoundary: GeoJSONFeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [23.32, 42.69], // Southwest corner
              [23.33, 42.69], // Southeast corner
              [23.33, 42.7], // Northeast corner
              [23.32, 42.7], // Northwest corner
              [23.32, 42.69], // Close the polygon
            ],
          ],
        },
        properties: {},
      },
    ],
  };

  const createPoint = (
    lng: number,
    lat: number,
    name: string = "Test"
  ): any => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [lng, lat],
    },
    properties: { name },
  });

  const createFeatureCollection = (
    features: any[]
  ): GeoJSONFeatureCollection => ({
    type: "FeatureCollection",
    features,
  });

  describe("filterFeaturesByBoundaries", () => {
    it("should return null for null input", () => {
      const result = filterFeaturesByBoundaries(null, testBoundary);
      expect(result).toBeNull();
    });

    it("should return null for empty feature collection", () => {
      const emptyCollection = createFeatureCollection([]);
      const result = filterFeaturesByBoundaries(emptyCollection, testBoundary);
      expect(result).toBeNull();
    });

    it("should keep features within boundary", () => {
      const features = createFeatureCollection([
        createPoint(23.325, 42.695, "Inside"), // Within boundary
      ]);

      const result = filterFeaturesByBoundaries(features, testBoundary);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(1);
      expect(result!.features[0].properties.name).toBe("Inside");
    });

    it("should filter out features outside boundary", () => {
      const features = createFeatureCollection([
        createPoint(23.325, 42.695, "Inside"),
        createPoint(25.0, 43.0, "Outside"), // Far outside
      ]);

      const result = filterFeaturesByBoundaries(features, testBoundary);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(1);
      expect(result!.features[0].properties.name).toBe("Inside");
    });

    it("should return null when all features are outside", () => {
      const features = createFeatureCollection([
        createPoint(25.0, 43.0, "Outside 1"),
        createPoint(24.0, 44.0, "Outside 2"),
      ]);

      const result = filterFeaturesByBoundaries(features, testBoundary);
      expect(result).toBeNull();
    });

    it("should handle features without valid geometry", () => {
      const features = createFeatureCollection([
        createPoint(23.325, 42.695, "Valid"),
        { type: "Feature", geometry: null, properties: {} },
        { type: "Feature", geometry: { type: "Point" }, properties: {} }, // Missing coordinates
      ]);

      const result = filterFeaturesByBoundaries(features, testBoundary);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(1);
      expect(result!.features[0].properties.name).toBe("Valid");
    });

    it("should handle LineString features", () => {
      const lineFeature = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [23.32, 42.69],
            [23.33, 42.7], // Line crosses the boundary
          ],
        },
        properties: { name: "Line" },
      };

      const features = createFeatureCollection([lineFeature]);
      const result = filterFeaturesByBoundaries(features, testBoundary);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(1);
    });

    it("should handle Polygon features", () => {
      const polygonFeature = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [23.323, 42.693],
              [23.327, 42.693],
              [23.327, 42.697],
              [23.323, 42.697],
              [23.323, 42.693],
            ],
          ],
        },
        properties: { name: "Polygon Inside" },
      };

      const features = createFeatureCollection([polygonFeature]);
      const result = filterFeaturesByBoundaries(features, testBoundary);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(1);
    });

    it("should keep features on boundary edge", () => {
      const edgeFeature = createPoint(23.32, 42.69, "On Edge");
      const features = createFeatureCollection([edgeFeature]);

      const result = filterFeaturesByBoundaries(features, testBoundary);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(1);
    });
  });

  describe("isWithinBoundaries", () => {
    it("should return true when all features are within boundary", () => {
      const features = createFeatureCollection([
        createPoint(23.325, 42.695, "Inside 1"),
        createPoint(23.326, 42.696, "Inside 2"),
      ]);

      const result = isWithinBoundaries(features, testBoundary);
      expect(result).toBe(true);
    });

    it("should return true when at least one feature is within boundary", () => {
      const features = createFeatureCollection([
        createPoint(23.325, 42.695, "Inside"),
        createPoint(25.0, 43.0, "Outside"),
      ]);

      const result = isWithinBoundaries(features, testBoundary);
      expect(result).toBe(true);
    });

    it("should return false when all features are outside boundary", () => {
      const features = createFeatureCollection([
        createPoint(25.0, 43.0, "Outside 1"),
        createPoint(24.0, 44.0, "Outside 2"),
      ]);

      const result = isWithinBoundaries(features, testBoundary);
      expect(result).toBe(false);
    });

    it("should skip features without valid geometry", () => {
      const features = createFeatureCollection([
        { type: "Feature", geometry: null, properties: {} },
        createPoint(25.0, 43.0, "Outside"),
      ]);

      const result = isWithinBoundaries(features, testBoundary);
      expect(result).toBe(false);
    });

    it("should return true on error (fail-safe behavior)", () => {
      // Create a feature with invalid geometry that might cause errors
      const invalidFeatures: any = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "InvalidType",
              coordinates: "invalid",
            },
            properties: {},
          },
        ],
      };

      const result = isWithinBoundaries(invalidFeatures, testBoundary);
      // Should return true as a fail-safe
      expect(result).toBe(true);
    });

    it("should handle empty feature collection", () => {
      const features = createFeatureCollection([]);
      const result = isWithinBoundaries(features, testBoundary);
      expect(result).toBe(false);
    });
  });

  describe("complex scenarios", () => {
    it("should handle MultiPoint geometry", () => {
      const multiPoint = {
        type: "Feature",
        geometry: {
          type: "MultiPoint",
          coordinates: [
            [23.325, 42.695], // Inside
            [25.0, 43.0], // Outside
          ],
        },
        properties: { name: "MultiPoint" },
      };

      const features = createFeatureCollection([multiPoint]);
      const result = filterFeaturesByBoundaries(features, testBoundary);

      // Should keep the feature if any point is inside
      expect(result).not.toBeNull();
    });

    it("should handle features partially overlapping boundary", () => {
      const partialOverlap = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [23.31, 42.695], // Outside
            [23.325, 42.695], // Inside
          ],
        },
        properties: { name: "Partial" },
      };

      const features = createFeatureCollection([partialOverlap]);
      const result = filterFeaturesByBoundaries(features, testBoundary);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(1);
    });

    it("should work with multiple boundary features", () => {
      const multipleBoundaries: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [23.32, 42.69],
                  [23.325, 42.69],
                  [23.325, 42.7],
                  [23.32, 42.7],
                  [23.32, 42.69],
                ],
              ],
            },
            properties: {},
          },
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [23.325, 42.69],
                  [23.33, 42.69],
                  [23.33, 42.7],
                  [23.325, 42.7],
                  [23.325, 42.69],
                ],
              ],
            },
            properties: {},
          },
        ],
      };

      const features = createFeatureCollection([
        createPoint(23.322, 42.695, "In First"),
        createPoint(23.327, 42.695, "In Second"),
        createPoint(25.0, 43.0, "Outside Both"),
      ]);

      const result = filterFeaturesByBoundaries(features, multipleBoundaries);

      expect(result).not.toBeNull();
      expect(result!.features).toHaveLength(2);
    });
  });
});
