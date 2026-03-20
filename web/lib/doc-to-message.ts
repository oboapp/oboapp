import type { Message } from "@/lib/types";
import {
  toOptionalISOString,
  toRequiredISOString,
} from "@/lib/date-serialization";
import {
  getAddresses,
  getBusStops,
  getCadastralProperties,
  getCategories,
  getFeatureCollection,
  getPins,
  getStreets,
} from "@/lib/typed-arrays";

/**
 * Convert a database record to a public Message object.
 * The @oboapp/db adapter handles JSON parsing and Timestamp→Date conversion,
 * so this function only needs to map fields and convert Dates to ISO strings.
 */

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function recordToMessage(record: Record<string, unknown>): Message {
  return {
    id: typeof record._id === "string" ? record._id : undefined,
    text: typeof record.text === "string" ? record.text : "",
    locality: typeof record.locality === "string" ? record.locality : "",
    plainText: optionalString(record.plainText),
    addresses: getAddresses(record.addresses),
    geoJson: getFeatureCollection(record.geoJson),
    crawledAt: toOptionalISOString(record.crawledAt, "crawledAt"),
    createdAt: toRequiredISOString(record.createdAt, "createdAt"),
    finalizedAt: toOptionalISOString(record.finalizedAt, "finalizedAt"),
    source: optionalString(record.source),
    sourceUrl: optionalString(record.sourceUrl),
    markdownText: optionalString(record.markdownText),
    categories: getCategories(record.categories),
    timespanStart: toOptionalISOString(record.timespanStart, "timespanStart"),
    timespanEnd: toOptionalISOString(record.timespanEnd, "timespanEnd"),
    cityWide: record.cityWide === true,
    responsibleEntity: optionalString(record.responsibleEntity),
    pins: getPins(record.pins),
    streets: getStreets(record.streets),
    cadastralProperties: getCadastralProperties(record.cadastralProperties),
    busStops: getBusStops(record.busStops),
  };
}
