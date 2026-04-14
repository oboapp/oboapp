import type { MessageV2 } from "../schema/contract.v2";
import { toOptionalISOString, toRequiredISOString } from "./date-serialization";
import { getCategories, getFeatureCollection } from "./typed-arrays";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Convert a database record to a public v2 Message object.
 *
 * Compared to v1, omits pipeline-internal fields that are derivable from
 * geoJson: addresses, pins, streets, cadastralProperties, busStops.
 */
export function recordToMessageV2(record: Record<string, unknown>): MessageV2 {
  return {
    id: typeof record._id === "string" ? record._id : undefined,
    text: typeof record.text === "string" ? record.text : "",
    locality: typeof record.locality === "string" ? record.locality : "",
    plainText: optionalString(record.plainText),
    markdownText: optionalString(record.markdownText),
    source: optionalString(record.source),
    sourceUrl: optionalString(record.sourceUrl),
    categories: getCategories(record.categories),
    geoJson: getFeatureCollection(record.geoJson),
    crawledAt: toOptionalISOString(record.crawledAt, "crawledAt"),
    createdAt: toRequiredISOString(record.createdAt, "createdAt"),
    finalizedAt: toOptionalISOString(record.finalizedAt, "finalizedAt"),
    timespanStart: toOptionalISOString(record.timespanStart, "timespanStart"),
    timespanEnd: toOptionalISOString(record.timespanEnd, "timespanEnd"),
    cityWide: record.cityWide === true,
    responsibleEntity: optionalString(record.responsibleEntity),
  };
}
