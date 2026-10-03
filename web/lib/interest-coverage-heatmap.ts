import type { InterestCoverageReport } from "@oboapp/shared";

export const COVERAGE_SAMPLES_PER_AXIS = 4;

/** Uniform rendering samples of published cells, never individual zone locations. */
export function makeCoverageHeatPoints(report: InterestCoverageReport): [number, number, number][] {
  if (report.status !== "available") return [];
  const maximum = Math.max(10, ...report.cells.map((cell) => cell.users.min));
  return report.cells.flatMap((cell) => {
    const points: [number, number, number][] = [];
    for (let row = 0; row < COVERAGE_SAMPLES_PER_AXIS; row++) {
      for (let column = 0; column < COVERAGE_SAMPLES_PER_AXIS; column++) {
        points.push([
          cell.south + (row + 0.5) * (cell.north - cell.south) / COVERAGE_SAMPLES_PER_AXIS,
          cell.west + (column + 0.5) * (cell.east - cell.west) / COVERAGE_SAMPLES_PER_AXIS,
          cell.users.min / maximum,
        ]);
      }
    }
    return points;
  });
}
