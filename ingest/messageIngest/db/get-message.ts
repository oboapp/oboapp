import { getDb } from "@/lib/db";
import type { InternalMessage } from "@/lib/types";
import {
  getString,
  getOptionalString,
  getOptionalBoolean,
  isFeatureCollection,
} from "@/lib/record-fields";

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function toOptionalISOString(value: unknown): string | undefined {
  if (!value) return undefined;
  return toISOString(value);
}

/**
 * Get a message by ID.
 * Returns InternalMessage with all internal fields.
 * The db adapter handles deserialization (parses JSON strings from Firestore,
 * native objects from MongoDB).
 */
export async function getMessageById(
  messageId: string,
): Promise<InternalMessage | null> {
  const db = await getDb();
  const data = await db.messages.findById(messageId);

  if (!data) {
    return null;
  }

  return {
    id: getString(data._id),
    text: getString(data.text),
    locality: getString(data.locality),
    addresses: Array.isArray(data.addresses) ? data.addresses : [],
    geoJson: isFeatureCollection(data.geoJson) ? data.geoJson : undefined,
    crawledAt: toOptionalISOString(data.crawledAt),
    createdAt: toISOString(data.createdAt),
    finalizedAt: toOptionalISOString(data.finalizedAt),
    source: getString(data.source),
    sourceUrl: getOptionalString(data.sourceUrl),
    markdownText: getOptionalString(data.markdownText),
    categories: Array.isArray(data.categories) ? data.categories : [],
    timespanStart: toOptionalISOString(data.timespanStart),
    timespanEnd: toOptionalISOString(data.timespanEnd),
    cityWide: getOptionalBoolean(data.cityWide) || false,
    responsibleEntity: getOptionalString(data.responsibleEntity),
    pins: Array.isArray(data.pins) ? data.pins : undefined,
    streets: Array.isArray(data.streets) ? data.streets : undefined,
    cadastralProperties: Array.isArray(data.cadastralProperties) ? data.cadastralProperties : undefined,
    busStops: Array.isArray(data.busStops) ? data.busStops : undefined,
    // Internal-only fields
    process: Array.isArray(data.process) ? data.process : undefined,
    ingestErrors: Array.isArray(data.ingestErrors) ? data.ingestErrors : undefined,
    sourceDocumentId: getOptionalString(data.sourceDocumentId),
    isRelevant: getOptionalBoolean(data.isRelevant),
  };
}
