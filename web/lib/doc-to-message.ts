import type { Message, GeoJSONFeatureCollection } from "@/lib/types";
import {
  toOptionalISOString,
  toRequiredISOString,
} from "@/lib/date-serialization";

/**
 * Convert a database record to a public Message object.
 * The @oboapp/db adapter handles JSON parsing and Timestamp→Date conversion,
 * so this function only needs to map fields and convert Dates to ISO strings.
 */

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isFeatureCollection(
  value: unknown,
): value is GeoJSONFeatureCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "FeatureCollection" &&
    "features" in value &&
    Array.isArray(value.features)
  );
}

export function recordToMessage(record: Record<string, unknown>): Message {
  return {
    id: String(record._id ?? ""),
    text: typeof record.text === "string" ? record.text : "",
    locality: typeof record.locality === "string" ? record.locality : "",
    plainText: optionalString(record.plainText),
    addresses: Array.isArray(record.addresses) ? record.addresses : [],
    geoJson: isFeatureCollection(record.geoJson) ? record.geoJson : undefined,
    crawledAt: toOptionalISOString(record.crawledAt, "crawledAt"),
    createdAt: toRequiredISOString(record.createdAt, "createdAt"),
    finalizedAt: toOptionalISOString(record.finalizedAt, "finalizedAt"),
    source: optionalString(record.source),
    sourceUrl: optionalString(record.sourceUrl),
    markdownText: optionalString(record.markdownText),
    categories: Array.isArray(record.categories) ? record.categories : [],
    timespanStart: toOptionalISOString(record.timespanStart, "timespanStart"),
    timespanEnd: toOptionalISOString(record.timespanEnd, "timespanEnd"),
    cityWide: record.cityWide === true,
    responsibleEntity: optionalString(record.responsibleEntity),
    pins: Array.isArray(record.pins) ? record.pins : undefined,
    streets: Array.isArray(record.streets) ? record.streets : undefined,
    cadastralProperties: Array.isArray(record.cadastralProperties)
      ? record.cadastralProperties
      : undefined,
    busStops: Array.isArray(record.busStops) ? record.busStops : undefined,
  };
}
