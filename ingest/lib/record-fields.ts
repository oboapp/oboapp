/**
 * Type-safe field extraction from Record<string, unknown>.
 * Used to replace `as` type assertions when reading database records.
 */

import type { GeoJSONFeatureCollection } from "@/lib/types";

export function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

export function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function getBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function getOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function getArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function getRequiredArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function getStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : undefined;
}

export function getNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: number[] = [];
  for (const item of value) {
    if (typeof item === "number") {
      result.push(item);
    } else {
      return undefined; // Mixed types — not a valid number array
    }
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * Extract a string or Date value, returning it unchanged.
 * Useful for fields that may be stored as either type in the DB.
 */
export function getStringOrDate(value: unknown): string | Date | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value;
  return undefined;
}

/**
 * Extract a string or Date value, with null fallback.
 * Useful for nullable timespan fields in event matching.
 */
export function getStringOrDateOrNull(value: unknown): string | Date | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value;
  return null;
}

/**
 * Type guard to check if an unknown error has a `code` property.
 * Used to replace `(error as { code?: string }).code` patterns.
 */
export function hasCode(error: unknown): error is { code: unknown } {
  return typeof error === "object" && error !== null && "code" in error;
}

/**
 * Type guard for GeoJSON FeatureCollection shape.
 * When this returns true, the value can safely be used where
 * GeoJSONFeatureCollection is expected (it has the required structure).
 */
export function isFeatureCollection(value: unknown): value is GeoJSONFeatureCollection {
  return (
    isRecord(value) &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

/**
 * Get coordinates from an unknown value.
 * Returns Interest-shaped coordinates or undefined.
 */
export function getCoordinates(value: unknown): { lat: number; lng: number } | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.lat !== "number" || typeof value.lng !== "number") return undefined;
  return { lat: value.lat, lng: value.lng };
}

/**
 * Extract an array of street objects from an unknown value.
 * Each element must be an object with a string `street` property.
 */
export function getStreetArray(value: unknown): Array<{ street: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  // Validate each element has the expected shape
  const result: Array<{ street: string }> = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.street === "string") {
      result.push({ street: item.street });
    }
  }
  return result.length > 0 ? result : undefined;
}
