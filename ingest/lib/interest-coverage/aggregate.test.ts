import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { InterestCoverageReportSchema, makeInterestRaster } from "@oboapp/shared";
import { aggregateInterestCoverage } from "./aggregate";

const locality = "bg.sofia";
const secret = "test-only-stable-key-with-at-least-32-bytes";
const center = { lat: 42.6977, lng: 23.3219 };
function zones(count: number, coordinates = center, radius = 500) {
  return Array.from({ length: count }, (_, index) => ({
    userId: `user-${index}`, coordinates, radius, label: "secret", _id: `zone-${index}`,
  }));
}
function report(records: Record<string, unknown>[]) {
  return aggregateInterestCoverage(records, locality, secret, "2026-10-02T10:00:00.000Z");
}
function pixels(result: ReturnType<typeof report>) {
  if (!result.image) throw new Error("Expected an image");
  return PNG.sync.read(Buffer.from(result.image.dataUrl.split(",")[1], "base64"));
}

describe("server-generated interest coverage", () => {
  it("withholds map and totals below ten distinct people, even with many zones", () => {
    expect(report(zones(9))).toMatchObject({ version: 2, status: "unavailable", summary: null, image: null });
    expect(report(Array(100).fill(zones(1)[0])).image).toBeNull();
    expect(report(zones(10)).status).toBe("available");
  });
  it("deduplicates overlapping circles per person without losing total saved zones", () => {
    const single = report(zones(10));
    const duplicate = report([...zones(10), ...zones(10)]);
    expect(duplicate.image).toEqual(single.image);
    expect(duplicate.summary?.interests).toEqual({ min: 20, max: 29 });
    expect(duplicate.summary?.users).toEqual({ min: 10, max: 19 });
  });
  it("allows people with different sets of interests to contribute to a shared area", () => {
    const baseline = report(zones(10));
    const extra = { userId: "user-9", coordinates: { lat: 42.75, lng: 23.4 }, radius: 100 };
    expect(report([...zones(10), extra]).image).toEqual(baseline.image);
  });
  it("removes isolated zones completely, not just their visible alpha", () => {
    const baseline = report(zones(10));
    const isolated = { userId: "isolated", coordinates: { lat: 42.75, lng: 23.4 }, radius: 100 };
    expect(report([...zones(10), isolated]).image).toEqual(baseline.image);
    const scattered = zones(10).map((zone, i) => ({ ...zone, radius: 100, coordinates: { lat: 42.62 + i * 0.018, lng: 23.22 } }));
    expect(report(scattered)).toMatchObject({ status: "unavailable", summary: null, image: null });
  });
  it("renders the circle extent, with more coverage for larger radii", () => {
    const small = pixels(report(zones(10, center, 100)));
    const large = pixels(report(zones(10, center, 1000)));
    const visible = (png: PNG) => png.data.filter((value, index) => index % 4 === 3 && value > 0).length;
    expect(visible(large)).toBeGreaterThan(visible(small) * 2);
  });
  it("is reproducible across runs, input ordering and report dates", () => {
    const first = report(zones(10));
    expect(report(zones(10).reverse()).image).toEqual(first.image);
    expect(aggregateInterestCoverage(zones(10), locality, secret, "2026-10-03T10:00:00.000Z").image).toEqual(first.image);
  });
  it("ignores malformed and outside-city records and includes boundary intersections", () => {
    const bad = [
      { userId: "bad", coordinates: { lat: Number.NaN, lng: center.lng }, radius: 500 },
      { userId: "", coordinates: center, radius: 500 },
      { userId: "bad", coordinates: center, radius: Number.POSITIVE_INFINITY },
      { userId: "bad", coordinates: { lat: 0, lng: 0 }, radius: 500 },
    ];
    expect(report([...zones(9), ...bad]).status).toBe("unavailable");
    expect(report(zones(10, { lat: 42.604, lng: 23.3 }, 1000)).status).toBe("available");
  });
  it("publishes only a valid fixed-size PNG and banded totals", () => {
    const result = report(zones(10));
    expect(InterestCoverageReportSchema.safeParse(result).success).toBe(true);
    const raster = makeInterestRaster(locality);
    const png = pixels(result);
    expect([png.width, png.height]).toEqual([raster.width, raster.height]);
    for (const key of ["userId", "coordinates", "radius", "label", "cells", "user-", "zone-"]) {
      expect(JSON.stringify(result)).not.toContain(key);
    }
    expect(InterestCoverageReportSchema.safeParse({ ...result, cells: [] }).success).toBe(false);
    expect(InterestCoverageReportSchema.safeParse({ ...result, image: { ...result.image, width: 10 } }).success).toBe(false);
    expect(InterestCoverageReportSchema.safeParse({ ...result, image: { ...result.image, dataUrl: "data:image/svg+xml,<svg/>" } }).success).toBe(false);
  });
});
