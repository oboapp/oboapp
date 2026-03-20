import type { InternalMessage, GeoJSONFeatureCollection } from "@/lib/types";
import {
  toOptionalISOString,
  toRequiredISOString,
} from "@/lib/date-serialization";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

export function recordToInternalMessage(
  record: Record<string, unknown>,
): InternalMessage {
  return {
    id: String(record._id ?? ""),
    text: typeof record.text === "string" ? record.text : "",
    locality: typeof record.locality === "string" ? record.locality : "",
    plainText: optionalString(record.plainText),
    markdownText: optionalString(record.markdownText),
    addresses: Array.isArray(record.addresses) ? record.addresses : [],
    geoJson: isFeatureCollection(record.geoJson) ? record.geoJson : undefined,
    crawledAt: toOptionalISOString(record.crawledAt, "crawledAt"),
    createdAt: toRequiredISOString(record.createdAt, "createdAt"),
    finalizedAt: toOptionalISOString(record.finalizedAt, "finalizedAt"),
    source: optionalString(record.source),
    sourceUrl: optionalString(record.sourceUrl),
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
    // Internal-only fields
    process: Array.isArray(record.process) ? record.process : undefined,
    ingestErrors: Array.isArray(record.ingestErrors)
      ? record.ingestErrors
      : undefined,
    isRelevant: optionalBoolean(record.isRelevant),
    isUnreadable: optionalBoolean(record.isUnreadable),
  };
}
