import { describe, expect, it } from "vitest";
import { makeInterestCoverageGrid } from "@oboapp/shared";
import type { InterestCoverageReport } from "@oboapp/shared";
import { makeCoverageHeatPoints } from "./interest-coverage-heatmap";

const cells = makeInterestCoverageGrid("bg.sofia").cells;
const report: InterestCoverageReport = {
  version: 1, locality: "bg.sofia", generatedAt: "2026-10-03T10:00:00.000Z",
  gridMeters: 2000, status: "available",
  summary: { users: { min: 50, max: 59 }, interests: { min: 50, max: 59 } },
  cells: [
    { ...cells[0], users: { min: 10, max: 19 } },
    { ...cells[2], users: { min: 50, max: 59 } },
  ],
};

describe("coverage heatmap privacy and density", () => {
  it("samples only published cells, preserving their relative band density", () => {
    const points = makeCoverageHeatPoints(report);
    expect(points.length).toBeGreaterThan(report.cells.length);
    for (const [lat, lng, weight] of points) {
      const cell = report.cells.find((candidate) => lat > candidate.south && lat < candidate.north && lng > candidate.west && lng < candidate.east);
      expect(cell).toBeDefined();
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
    const low = points.filter(([lat, lng]) => lat < cells[0].north && lng < cells[0].east);
    const high = points.filter(([lat, lng]) => lat > cells[2].south && lat < cells[2].north && lng > cells[2].west && lng < cells[2].east);
    expect(low).toHaveLength(high.length);
    expect(high[0][2] / low[0][2]).toBe(5);
  });

  it("renders no heat for unavailable snapshots", () => {
    expect(makeCoverageHeatPoints({ ...report, status: "unavailable", summary: null, cells: [] })).toEqual([]);
  });
});
