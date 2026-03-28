/**
 * European Air Quality Index (EAQI) calculation with NowCast weighting.
 *
 * Uses the European Environment Agency (EEA) concentration bands for PM2.5/PM10,
 * mapped to a 1–6 index scale with linear interpolation within each band.
 * NowCast weighting gives more weight to recent hours for short-term estimation.
 *
 * Reference: https://airindex.eea.europa.eu/AQI/index.html
 */

import { NOWCAST_MIN_WEIGHT } from "./constants";

/**
 * EEA PM2.5 concentration bands (μg/m³).
 * Each band maps to an integer index level (1–6) with interpolation within.
 */
const PM25_BANDS = [
  { cLow: 0, cHigh: 10, index: 1 },
  { cLow: 10, cHigh: 20, index: 2 },
  { cLow: 20, cHigh: 25, index: 3 },
  { cLow: 25, cHigh: 50, index: 4 },
  { cLow: 50, cHigh: 75, index: 5 },
  // cHigh 800 is an infinity cap for the interpolation math — concentrations
  // above 75 all map to index 6 (Extremely Poor), capped by Math.min(…, 6).
  { cLow: 75, cHigh: 800, index: 6 },
] as const;

/**
 * EEA PM10 concentration bands (μg/m³).
 */
const PM10_BANDS = [
  { cLow: 0, cHigh: 20, index: 1 },
  { cLow: 20, cHigh: 40, index: 2 },
  { cLow: 40, cHigh: 50, index: 3 },
  { cLow: 50, cHigh: 100, index: 4 },
  { cLow: 100, cHigh: 150, index: 5 },
  // cHigh 1200 is an infinity cap — same rationale as PM25_BANDS above.
  { cLow: 150, cHigh: 1200, index: 6 },
] as const;

interface HourlyAverage {
  pm25: number;
  pm10: number;
}

/**
 * Map a PM concentration to an EAQI index (1–6) using the EEA bands.
 * Interpolates linearly within each band for sub-band granularity.
 * Returns a fractional value, e.g. 4.3 means "40% into the Poor band".
 */
function eaqiFromBands(
  concentration: number,
  bands: readonly { cLow: number; cHigh: number; index: number }[],
): number {
  if (concentration <= 0) return 1;

  for (const band of bands) {
    if (concentration >= band.cLow && concentration < band.cHigh) {
      const fraction = (concentration - band.cLow) / (band.cHigh - band.cLow);
      return band.index + fraction * 0.99; // stay within band
    }
  }
  // Above all bands — cap at 6
  return 6;
}

/**
 * Compute NowCast weighted concentration from hourly averages.
 *
 * The NowCast algorithm:
 * 1. Find min and max concentrations across available hours
 * 2. Compute weight factor: w = 1 - (range / max), floor at NOWCAST_MIN_WEIGHT
 * 3. Weighted average: Σ(w^i × c_i) / Σ(w^i) where i=0 is most recent
 *
 * Returns NaN if no valid values.
 */
function nowCastWeightedAverage(values: number[]): number {
  const valid = values.filter((v) => !Number.isNaN(v) && v >= 0);
  if (valid.length === 0) return NaN;

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min;

  const w = max > 0 ? Math.max(1 - range / max, NOWCAST_MIN_WEIGHT) : 1;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < valid.length; i++) {
    const weight = Math.pow(w, i);
    numerator += weight * valid[i];
    denominator += weight;
  }

  return denominator > 0 ? numerator / denominator : NaN;
}

/**
 * Calculate EAQI from hourly averages using NowCast weighting.
 *
 * @param hourlyAverages - Array of hourly PM averages, ordered most-recent first.
 *   Missing hours should be omitted (not included as NaN).
 * @returns EAQI index (1–6 fractional), or 0 if input is empty/invalid.
 */
export function calculateNowCastAqi(hourlyAverages: HourlyAverage[]): number {
  if (hourlyAverages.length === 0) return 0;

  const pm25Values = hourlyAverages.map((h) => h.pm25);
  const pm10Values = hourlyAverages.map((h) => h.pm10);

  const nowCastPm25 = nowCastWeightedAverage(pm25Values);
  const nowCastPm10 = nowCastWeightedAverage(pm10Values);

  if (Number.isNaN(nowCastPm25) && Number.isNaN(nowCastPm10)) return 0;

  const eaqiPm25 = Number.isNaN(nowCastPm25)
    ? 0
    : eaqiFromBands(nowCastPm25, PM25_BANDS);
  const eaqiPm10 = Number.isNaN(nowCastPm10)
    ? 0
    : eaqiFromBands(nowCastPm10, PM10_BANDS);

  // Round to 1 decimal for readable thresholds, cap at 6
  return Math.min(Math.round(Math.max(eaqiPm25, eaqiPm10) * 10) / 10, 6);
}

/**
 * Get a human-readable EAQI category label (in Bulgarian).
 */
export function getAqiLabel(aqi: number): string {
  if (aqi < 2) return "Добро";
  if (aqi < 3) return "Задоволително";
  if (aqi < 4) return "Умерено";
  if (aqi < 5) return "Лошо";
  if (aqi < 6) return "Много лошо";
  return "Изключително лошо";
}

/**
 * Get EAQI category key (for programmatic use).
 */
export function getAqiCategory(
  aqi: number,
): "good" | "fair" | "moderate" | "poor" | "very-poor" | "extremely-poor" {
  if (aqi < 2) return "good";
  if (aqi < 3) return "fair";
  if (aqi < 4) return "moderate";
  if (aqi < 5) return "poor";
  if (aqi < 6) return "very-poor";
  return "extremely-poor";
}
