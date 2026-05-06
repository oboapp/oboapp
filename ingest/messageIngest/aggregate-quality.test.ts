import { describe, it, expect } from "vitest";
import { aggregateMessageGeometryQuality } from "./aggregate-quality";

describe("aggregateMessageGeometryQuality", () => {
  it("returns 0 for null geoJson", () => {
    const quality = aggregateMessageGeometryQuality(null);
    expect(quality).toBe(0);
  });

  it("returns 0 for undefined geoJson", () => {
    const quality = aggregateMessageGeometryQuality(undefined);
    expect(quality).toBe(0);
  });

  it("returns 0 for empty features array", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [],
    });
    expect(quality).toBe(0);
  });

  it("returns quality of single feature", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.32, 42.69] },
          properties: { geometryQuality: 3, qualityProvider: "precomputed" },
        },
      ],
    });
    expect(quality).toBe(3);
  });

  it("returns minimum quality across multiple features (conservative)", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.32, 42.69] },
          properties: { geometryQuality: 3 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.33, 42.7] },
          properties: { geometryQuality: 2 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.34, 42.71] },
          properties: { geometryQuality: 1 },
        },
      ],
    });
    expect(quality).toBe(1); // min(3, 2, 1) = 1
  });

  it("returns 0 when features lack geometryQuality property", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.32, 42.69] },
          properties: { feature_type: "pin" },
        },
      ],
    });
    expect(quality).toBe(0);
  });

  it("returns 0 when geometryQuality is not a number", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.32, 42.69] },
          properties: { geometryQuality: "high" },
        },
      ],
    });
    expect(quality).toBe(0);
  });

  it("treats features without geometryQuality as 0 (conservative)", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.32, 42.69] },
          properties: { feature_type: "pin" }, // no geometryQuality
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.33, 42.7] },
          properties: { geometryQuality: 2 },
        },
      ],
    });
    expect(quality).toBe(0); // missing quality treated as 0 → min(0, 2) = 0
  });

  it("treats any ungraded feature as 0 (conservative min)", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.32, 42.69] },
          properties: { geometryQuality: 2 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.33, 42.7] },
          properties: { feature_type: "street" }, // no geometryQuality → treated as 0
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.34, 42.71] },
          properties: { geometryQuality: 1 },
        },
      ],
    });
    expect(quality).toBe(0); // min(2, 0, 1) = 0
  });

  it("returns ungradedFallback when all features lack quality stamps (legacy data)", () => {
    const quality = aggregateMessageGeometryQuality(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [23.32, 42.69] },
            properties: { feature_type: "pin" },
          },
        ],
      },
      1,
    );
    expect(quality).toBe(1);
  });

  it("floors non-integer quality values (conservative)", () => {
    const quality = aggregateMessageGeometryQuality({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [23.32, 42.69] },
          properties: { geometryQuality: 2.6 },
        },
      ],
    });
    expect(quality).toBe(2); // Math.floor(2.6) = 2, not 3
  });
});
