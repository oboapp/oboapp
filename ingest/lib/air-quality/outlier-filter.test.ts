import { describe, it, expect } from "vitest";
import { filterOutliers } from "./outlier-filter";
import type { ParsedReading } from "./parse-sensor-response";

function makeReading(overrides: Partial<ParsedReading> = {}): ParsedReading {
  return {
    sensorId: 1,
    sensorType: "SDS011",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    lat: 42.7,
    lng: 23.3,
    p1: 30,
    p2: 15,
    ...overrides,
  };
}

describe("filterOutliers", () => {
  it("returns empty array for empty input", () => {
    expect(filterOutliers([])).toEqual([]);
  });

  it("removes readings with PM values exceeding hard cap", () => {
    const readings = [
      makeReading({ sensorId: 1, p1: 30, p2: 15 }),
      makeReading({ sensorId: 2, p1: 1000, p2: 15 }), // p1 > 999.9
      makeReading({ sensorId: 3, p1: 30, p2: 1500 }), // p2 > 999.9
    ];
    const filtered = filterOutliers(readings);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sensorId).toBe(1);
  });

  it("removes readings with NaN or Infinity PM values", () => {
    const readings = [
      makeReading({ sensorId: 1, p1: 30, p2: 15 }),
      makeReading({ sensorId: 2, p1: NaN, p2: 15 }),
      makeReading({ sensorId: 3, p1: 30, p2: Infinity }),
    ];
    const filtered = filterOutliers(readings);
    expect(filtered).toHaveLength(1);
  });

  it("removes readings with negative PM values", () => {
    const readings = [
      makeReading({ sensorId: 1, p1: 30, p2: 15 }),
      makeReading({ sensorId: 2, p1: -5, p2: 15 }),
    ];
    const filtered = filterOutliers(readings);
    expect(filtered).toHaveLength(1);
  });

  it("skips IQR filtering when fewer than 4 readings remain after hard cap", () => {
    const readings = [
      makeReading({ sensorId: 1, p1: 30, p2: 15 }),
      makeReading({ sensorId: 2, p1: 500, p2: 200 }), // large but under cap
      makeReading({ sensorId: 3, p1: 40, p2: 20 }),
    ];
    const filtered = filterOutliers(readings);
    // All 3 pass hard cap, < 4 so no IQR filtering
    expect(filtered).toHaveLength(3);
  });

  it("applies IQR filtering to remove statistical outliers", () => {
    // Create tight cluster + one outlier per pollutant
    const readings = [
      makeReading({ sensorId: 1, p1: 30, p2: 15 }),
      makeReading({ sensorId: 2, p1: 32, p2: 16 }),
      makeReading({ sensorId: 3, p1: 28, p2: 14 }),
      makeReading({ sensorId: 4, p1: 31, p2: 15.5 }),
      makeReading({ sensorId: 5, p1: 29, p2: 14.5 }),
      makeReading({ sensorId: 6, p1: 300, p2: 150 }), // outlier
    ];
    const filtered = filterOutliers(readings);
    // The outlier should be removed by IQR
    expect(filtered.length).toBeLessThan(readings.length);
    const ids = filtered.map((r) => r.sensorId);
    expect(ids).not.toContain(6);
  });

  it("keeps all readings when values are tightly clustered", () => {
    const readings = Array.from({ length: 10 }, (_, i) =>
      makeReading({ sensorId: i + 1, p1: 30 + i * 0.5, p2: 15 + i * 0.2 }),
    );
    const filtered = filterOutliers(readings);
    expect(filtered).toHaveLength(10);
  });

  it("removes extreme outlier via IQR, keeping consistent readings", () => {
    // 3 consistent low readings + 1 extreme outlier.
    // IQR filtering removes the outlier; downstream sensor count < MIN
    // would then skip this cell — this test documents that intention.
    const readings = [
      makeReading({ sensorId: 1, p1: 1, p2: 1 }),
      makeReading({ sensorId: 2, p1: 1, p2: 1 }),
      makeReading({ sensorId: 3, p1: 1, p2: 1 }),
      makeReading({ sensorId: 4, p1: 900, p2: 900 }),
    ];
    const filtered = filterOutliers(readings);
    // The extreme outlier should be removed; the remaining 3 are consistent
    expect(filtered.length).toBeLessThan(readings.length);
    expect(filtered.every((r) => r.p1 < 100)).toBe(true);
  });
});
