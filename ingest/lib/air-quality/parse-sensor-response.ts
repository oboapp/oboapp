/**
 * Parser for sensor.community API responses.
 *
 * Handles all the JS-level pitfalls:
 * - sensordatavalues are strings, not numbers
 * - lat/lng can be null
 * - indoor sensors must be excluded
 * - NaN values from "N/A" or malformed strings
 * - PM2.5 truncated to 1 decimal, PM10 to integer
 */

import { isWithinBounds } from "@oboapp/shared";
import { PM_HARD_CAP } from "./constants";

export interface ParsedReading {
  sensorId: number;
  sensorType: string;
  timestamp: Date;
  lat: number;
  lng: number;
  /** PM10 in μg/m³ (truncated to integer) */
  p1: number;
  /** PM2.5 in μg/m³ (truncated to 1 decimal) */
  p2: number;
}

interface SensorDataValue {
  value_type: string;
  value: string;
}

interface ApiSensorEntry {
  id: number;
  sensor: {
    id: number;
    sensor_type?: { name?: string };
  };
  location: {
    id: number;
    latitude: string | null;
    longitude: string | null;
    indoor: number;
  };
  timestamp: string;
  sensordatavalues: SensorDataValue[];
}

function isApiEntry(val: unknown): val is ApiSensorEntry {
  return val != null && typeof val === "object" && !Array.isArray(val);
}

/**
 * Parse sensor.community API response into validated readings.
 *
 * @param apiData - Raw JSON array from the sensor.community API
 * @param locality - Locality identifier for bounds checking (e.g., "bg.sofia")
 * @returns Array of validated, parsed readings
 */
export function parseSensorResponse(
  apiData: unknown[],
  locality: string,
): ParsedReading[] {
  const results: ParsedReading[] = [];

  for (const raw of apiData) {
    if (!isApiEntry(raw)) continue;
    const entry = raw;

    // Skip indoor sensors
    if (entry.location?.indoor === 1) continue;

    // Validate coordinates
    const lat = parseFloat(String(entry.location?.latitude ?? ""));
    const lng = parseFloat(String(entry.location?.longitude ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // Bounds check
    if (!isWithinBounds(locality, lat, lng)) continue;

    // Extract PM values from sensordatavalues
    let pm10 = NaN;
    let pm25 = NaN;

    if (!Array.isArray(entry.sensordatavalues)) continue;

    for (const sdv of entry.sensordatavalues) {
      // Defensive runtime validation in case the API returns malformed entries
      if (sdv == null || typeof sdv !== "object") continue;
      if (
        !("value" in sdv) ||
        !("value_type" in sdv) ||
        typeof sdv.value !== "string" ||
        typeof sdv.value_type !== "string"
      )
        continue;

      const value = parseFloat(sdv.value);
      if (!Number.isFinite(value) || value < 0) continue;

      // P1 = PM10, P2 = PM2.5 (sensor.community convention)
      if (sdv.value_type === "P1") pm10 = value;
      else if (sdv.value_type === "P2") pm25 = value;
    }

    // Must have both valid PM values for reliable downstream aggregation
    if (!Number.isFinite(pm10) || !Number.isFinite(pm25)) continue;

    // Apply hard cap
    if (pm10 > PM_HARD_CAP || pm25 > PM_HARD_CAP) continue;

    // Truncate for EAQI-style binning: PM2.5 → 1 decimal, PM10 → integer
    const p1 = Math.floor(pm10);
    const p2 = Math.floor(pm25 * 10) / 10;

    // sensor.community timestamps omit timezone — treat as UTC for deterministic parsing
    const ts = entry.timestamp;
    const timestamp = new Date(ts.endsWith("Z") ? ts : ts + "Z");
    if (Number.isNaN(timestamp.getTime())) continue;

    results.push({
      sensorId: entry.sensor?.id ?? entry.id,
      sensorType: entry.sensor?.sensor_type?.name ?? "unknown",
      timestamp,
      lat,
      lng,
      p1,
      p2,
    });
  }

  return results;
}
