import { describe, it, expect } from "vitest";
import { aggregateInterestCoverage, makeCoverageGrid } from "./aggregate";
import { InterestCoverageReportSchema } from "@oboapp/shared";

const locality = "bg.sofia";
const first = makeCoverageGrid(locality).cells[0];
const center = { lat: (first.south + first.north) / 2, lng: (first.west + first.east) / 2 };
function zones(count: number, coordinates = center, radius = 100) {
  return Array.from({ length: count }, (_, index) => ({
    userId: `user-${index}`, coordinates, radius, label: "secret", _id: `zone-${index}`,
  }));
}
function report(records: Record<string, unknown>[]) {
  return aggregateInterestCoverage(records, locality, "2026-10-02T10:00:00.000Z");
}

describe("interest coverage privacy and geography", () => {
  it("counts distinct users, withholding both counts and map below ten", () => {
    expect(report(zones(9))).toMatchObject({ status: "unavailable", summary: null, cells: [] });
    expect(report(Array(100).fill(zones(1)[0]))).toMatchObject({ status: "unavailable", cells: [] });
    expect(report(zones(10))).toMatchObject({ status: "available", summary: { users: { min: 10, max: 19 } } });
  });
  it("deduplicates overlapping zones per user per cell", () => {
    const result = report([...zones(10), ...zones(10)]);
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].users).toEqual({ min: 10, max: 19 });
    expect(result.summary?.interests).toEqual({ min: 20, max: 29 });
  });
  it("uses the circle extent rather than just its center", () => {
    const edge = { lat: center.lat, lng: first.east - 300 / makeCoverageGrid(locality).lngScale };
    expect(report(zones(10, edge, 100)).cells).toHaveLength(1);
    expect(report(zones(10, edge, 500)).cells).toHaveLength(2);
  });
  it("suppresses an isolated user's additional cell and entire combined signature", () => {
    const other = { lat: center.lat, lng: first.east + 0.015 };
    const result = report([...zones(10), { userId: "isolated", coordinates: other, radius: 100 }]);
    expect(result.cells).toHaveLength(1);
    const noCommonPattern = report([...zones(9), { userId: "user-9", coordinates: center, radius: 100 }, { userId: "user-9", coordinates: other, radius: 100 }]);
    // Ten users share cell A, but only nine share the complete A-only footprint.
    expect(noCommonPattern).toMatchObject({ status: "unavailable", cells: [] });
  });
  it("ignores invalid and outside-city records and handles boundary-crossing circles", () => {
    const bad = [
      { userId: "bad", coordinates: { lat: Number.NaN, lng: center.lng }, radius: 500 },
      { userId: "", coordinates: center, radius: 500 },
      { userId: "bad", coordinates: center, radius: Number.POSITIVE_INFINITY },
      { userId: "bad", coordinates: { lat: 0, lng: 0 }, radius: 500 },
    ];
    expect(report([...zones(9), ...bad]).status).toBe("unavailable");
    expect(report(zones(10, { lat: first.south - 0.001, lng: center.lng }, 500)).status).toBe("available");
  });
  it("publishes only fixed cell geometry and banded totals", () => {
    const result = report(zones(10));
    expect(InterestCoverageReportSchema.safeParse(result).success).toBe(true);
    const json = JSON.stringify(result);
    for (const secret of ["userId", "coordinates", "radius", "label", "zone-", "user-"]) expect(json).not.toContain(secret);
    expect(InterestCoverageReportSchema.safeParse({ ...result, cells: [{ ...result.cells[0], radius: 500 }] }).success).toBe(false);
  });
});
