import type { InternalMessage } from "@/lib/types";
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
  getIngestErrors,
  getPins,
  getProcessSteps,
  getStreets,
} from "@/lib/typed-arrays";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function recordToInternalMessage(
  record: Record<string, unknown>,
): InternalMessage {
  return {
    id: typeof record._id === "string" ? record._id : undefined,
    text: typeof record.text === "string" ? record.text : "",
    locality: typeof record.locality === "string" ? record.locality : "",
    plainText: optionalString(record.plainText),
    markdownText: optionalString(record.markdownText),
    addresses: getAddresses(record.addresses),
    geoJson: getFeatureCollection(record.geoJson),
    crawledAt: toOptionalISOString(record.crawledAt, "crawledAt"),
    createdAt: toRequiredISOString(record.createdAt, "createdAt"),
    finalizedAt: toOptionalISOString(record.finalizedAt, "finalizedAt"),
    source: optionalString(record.source),
    sourceUrl: optionalString(record.sourceUrl),
    categories: getCategories(record.categories),
    timespanStart: toOptionalISOString(record.timespanStart, "timespanStart"),
    timespanEnd: toOptionalISOString(record.timespanEnd, "timespanEnd"),
    cityWide: record.cityWide === true,
    responsibleEntity: optionalString(record.responsibleEntity),
    pins: getPins(record.pins),
    streets: getStreets(record.streets),
    cadastralProperties: getCadastralProperties(record.cadastralProperties),
    busStops: getBusStops(record.busStops),
    // Internal-only fields
    process: getProcessSteps(record.process),
    ingestErrors: getIngestErrors(record.ingestErrors),
    isRelevant: optionalBoolean(record.isRelevant),
    isUnreadable: optionalBoolean(record.isUnreadable),
  };
}
