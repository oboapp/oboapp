import { describe, it, expect } from "vitest";
import { computeMatchScore } from "./score";
import type { GeoJSONFeatureCollection } from "@/lib/types";

/** Helper to create a point FeatureCollection at given [lng, lat] */
function pointGeoJson(lng: number, lat: number): GeoJSONFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {},
      },
    ],
  };
}

describe("computeMatchScore", () => {
  it("same location + same time + same categories → score ~1.0", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { score, signals } = computeMatchScore(
      {
        geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
      {
        geoJson: geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
    );
    expect(score).toBeCloseTo(1.0, 1);
    expect(signals.locationSimilarity).toBeCloseTo(1.0, 1);
    expect(signals.timeOverlap).toBeCloseTo(1.0, 1);
    expect(signals.categoryMatch).toBeCloseTo(1.0, 1);
  });

  it("250m apart + overlapping time + same categories → above threshold", () => {
    // ~250m north of base point
    const msgGeo = pointGeoJson(23.3219, 42.6977);
    const evtGeo = pointGeoJson(23.3219, 42.6999); // ~245m north

    const { score, signals } = computeMatchScore(
      {
        geoJson: msgGeo,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
      {
        geoJson: evtGeo,
        timespanStart: "2025-03-01T06:00:00Z",
        timespanEnd: "2025-03-01T20:00:00Z",
        categories: ["water"],
      },
    );
    expect(signals.locationSimilarity).toBeGreaterThan(0.4);
    expect(signals.timeOverlap).toBeGreaterThan(0.5);
    expect(score).toBeGreaterThan(0.6);
  });

  it("600m apart → locationSimilarity = 0 → score low", () => {
    const msgGeo = pointGeoJson(23.3219, 42.6977);
    const evtGeo = pointGeoJson(23.3219, 42.7031); // ~600m north

    const { score, signals } = computeMatchScore(
      {
        geoJson: msgGeo,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
      {
        geoJson: evtGeo,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
    );
    expect(signals.locationSimilarity).toBe(0);
    expect(score).toBeLessThan(0.7);
  });

  it("no time overlap → timeOverlap = 0", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { signals } = computeMatchScore(
      {
        geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T10:00:00Z",
        categories: ["water"],
      },
      {
        geoJson: geoJson,
        timespanStart: "2025-03-05T08:00:00Z",
        timespanEnd: "2025-03-05T18:00:00Z",
        categories: ["water"],
      },
    );
    expect(signals.timeOverlap).toBe(0);
  });

  it("empty categories on both → categoryMatch = 0 (neutral)", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { signals } = computeMatchScore(
      {
        geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: [],
      },
      {
        geoJson: geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: [],
      },
    );
    expect(signals.categoryMatch).toBe(0);
  });

  it("city-wide + city-wide → location defaults to 1.0", () => {
    const { signals } = computeMatchScore(
      {
        geoJson: null,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["weather"],
        cityWide: true,
      },
      {
        geoJson: null,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["weather"],
        cityWide: true,
      },
    );
    expect(signals.locationSimilarity).toBe(1.0);
  });

  it("missing timespans → timeOverlap = 0", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { signals } = computeMatchScore(
      { geoJson, categories: ["water"] },
      { geoJson: geoJson, categories: ["water"] },
    );
    expect(signals.timeOverlap).toBe(0);
  });

  it("partial category overlap → fractional categoryMatch", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { signals } = computeMatchScore(
      { geoJson, categories: ["water", "traffic"], timespanStart: "2025-03-01T08:00:00Z", timespanEnd: "2025-03-01T18:00:00Z" },
      { geoJson: geoJson, categories: ["water", "electricity"], timespanStart: "2025-03-01T08:00:00Z", timespanEnd: "2025-03-01T18:00:00Z" },
    );
    // Jaccard: intersection=1 (water), union=3 → 1/3 ≈ 0.333
    expect(signals.categoryMatch).toBeCloseTo(1 / 3, 2);
  });

  it("with identical embeddings → textSimilarity = 1.0 and higher score", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const embedding = [0.1, 0.2, 0.3, 0.4];

    const withEmb = computeMatchScore(
      {
        geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
        embedding,
      },
      {
        geoJson: geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
        embedding,
      },
    );

    expect(withEmb.signals.textSimilarity).toBeCloseTo(1.0, 2);
    // 0.35*1 + 0.25*1 + 0.25*1 + 0.15*1 = 1.0
    expect(withEmb.score).toBeCloseTo(1.0, 1);
  });

  it("without embeddings → falls back to Phase 2 weights (no text signal)", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { score, signals } = computeMatchScore(
      {
        geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
      {
        geoJson: geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
    );

    expect(signals.textSimilarity).toBe(0);
    // Fallback: 0.50*1 + 0.35*1 + 0.15*1 = 1.0
    expect(score).toBeCloseTo(1.0, 1);
  });

  it("orthogonal embeddings → textSimilarity = 0", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { signals } = computeMatchScore(
      {
        geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
        embedding: [1, 0, 0],
      },
      {
        geoJson: geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
        embedding: [0, 1, 0],
      },
    );

    expect(signals.textSimilarity).toBeCloseTo(0.0, 2);
  });

  it("only message has embedding → falls back to Phase 2 weights", () => {
    const geoJson = pointGeoJson(23.3219, 42.6977);
    const { score, signals } = computeMatchScore(
      {
        geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
        embedding: [0.1, 0.2, 0.3],
      },
      {
        geoJson: geoJson,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
        categories: ["water"],
      },
    );

    expect(signals.textSimilarity).toBe(0);
    // Should use fallback weights
    expect(score).toBeCloseTo(1.0, 1);
  });
});
