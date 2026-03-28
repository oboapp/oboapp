/**
 * Outlier filtering for sensor.community readings.
 *
 * Two-stage filtering:
 * 1. Hard cap: discard readings with PM values > 999.9 or NaN
 * 2. IQR filter: per-pollutant, discard values outside [Q1 - 1.5×IQR, Q3 + 1.5×IQR]
 */

import { PM_HARD_CAP } from "./constants";
import type { ParsedReading } from "./parse-sensor-response";

/**
 * Filter outlier readings using hard cap + IQR.
 *
 * @param readings - Raw sensor readings (already assigned to a single grid cell)
 * @returns Filtered readings with outliers removed
 */
export function filterOutliers(readings: ParsedReading[]): ParsedReading[] {
  // Stage 1: Hard cap + NaN removal
  const afterHardCap = readings.filter(
    (r) =>
      Number.isFinite(r.p1) &&
      Number.isFinite(r.p2) &&
      r.p1 >= 0 &&
      r.p2 >= 0 &&
      r.p1 <= PM_HARD_CAP &&
      r.p2 <= PM_HARD_CAP,
  );

  if (afterHardCap.length < 4) return afterHardCap;

  // Stage 2: IQR filter per pollutant
  const p1Bounds = iqrBounds(afterHardCap.map((r) => r.p1));
  const p2Bounds = iqrBounds(afterHardCap.map((r) => r.p2));

  return afterHardCap.filter(
    (r) =>
      r.p1 >= p1Bounds.lower &&
      r.p1 <= p1Bounds.upper &&
      r.p2 >= p2Bounds.lower &&
      r.p2 <= p2Bounds.upper,
  );
}

interface IqrBoundsResult {
  lower: number;
  upper: number;
}

/**
 * Compute IQR-based outlier bounds for a set of values.
 * Values outside [Q1 - 1.5×IQR, Q3 + 1.5×IQR] are outliers.
 */
function iqrBounds(values: number[]): IqrBoundsResult {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;

  return {
    lower: q1 - 1.5 * iqr,
    upper: q3 + 1.5 * iqr,
  };
}

/**
 * Compute the p-th percentile of a sorted array using linear interpolation.
 */
function percentile(sorted: number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
