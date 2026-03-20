import type { OboDb } from "@oboapp/db";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import { getSourceTrust, getGeometryQuality } from "@/lib/source-trust";
import { isAlreadyExistsError, toISOString } from "./utils";
import { logger } from "@/lib/logger";
import { getLocality } from "@/lib/target-locality";

import { getString, getOptionalString } from "@/lib/record-fields";

/**
 * Create a new event from a message that didn't match any existing event.
 * Also creates the EventMessage link and returns the new event ID.
 */
export async function createEventFromMessage(
  db: OboDb,
  message: {
    _id: string;
    plainText?: string;
    text?: string;
    markdownText?: string;
    geoJson?: GeoJSONFeatureCollection | null;
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
    categories?: string[];
    source?: string;
    locality?: string;
    cityWide?: boolean;
    embedding?: number[] | null;
    pins?: unknown[];
    streets?: unknown[];
    cadastralProperties?: unknown[];
    busStops?: string[];
  },
): Promise<{ eventId: string; confidence: number; action: "created" | "attached" }> {
  const existingLinks = await db.eventMessages.findByMessageId(message._id);
  if (existingLinks.length > 0) {
    return {
      eventId: getString(existingLinks[0].eventId),
      confidence: 1.0,
      action: "attached",
    };
  }

  const source = typeof message.source === "string" ? message.source : "";
  const hasGeoJson = Boolean(message.geoJson);
  let geometryQuality = 0;
  if (hasGeoJson) {
    const isPrecomputedSource = getSourceTrust(source).geometryQuality === 3;
    geometryQuality = getGeometryQuality(source, isPrecomputedSource);
  }
  const now = new Date().toISOString();

  const eventId = await db.events.insertOne({
    plainText: message.plainText || message.text || "",
    ...(message.markdownText && { markdownText: message.markdownText }),
    ...(message.geoJson && { geoJson: message.geoJson }),
    geometryQuality,
    ...(message.timespanStart && { timespanStart: toISOString(message.timespanStart) }),
    ...(message.timespanEnd && { timespanEnd: toISOString(message.timespanEnd) }),
    categories: message.categories || [],
    sources: source ? [source] : [],
    messageCount: 1,
    confidence: 1.0,
    locality: message.locality || getLocality(),
    cityWide: message.cityWide || false,
    ...(message.embedding && { embedding: message.embedding }),
    ...(message.pins?.length && { pins: message.pins }),
    ...(message.streets?.length && { streets: message.streets }),
    ...(message.cadastralProperties?.length && { cadastralProperties: message.cadastralProperties }),
    ...(message.busStops?.length && { busStops: message.busStops }),
    createdAt: now,
    updatedAt: now,
  });

  try {
    await db.eventMessages.createOne(
      {
        eventId,
        messageId: message._id,
        source,
        confidence: 1.0,
        geometryQuality,
        matchSignals: null, // No matching process occurred — this is a new event,
        createdAt: now,
      },
      message._id,
    );
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    // Another worker linked this message concurrently. Reuse that link and
    // remove the orphaned event we just created.
    const concurrentLinks = await db.eventMessages.findByMessageId(message._id);
    const concurrentEventId = getOptionalString(concurrentLinks[0]?.eventId);

    try {
      await db.events.deleteOne(eventId);
    } catch (deleteError) {
      logger.warn("Failed to delete orphan event after concurrent message link", {
        messageId: message._id,
        orphanEventId: eventId,
        error: deleteError,
      });
    }

    if (!concurrentEventId) {
      throw error;
    }

    return { eventId: concurrentEventId, confidence: 1.0, action: "attached" };
  }

  return { eventId, confidence: 1.0, action: "created" };
}

