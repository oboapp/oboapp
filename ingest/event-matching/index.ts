import { logger } from "@/lib/logger";
import type { OboDb } from "@oboapp/db";
import { findBestMatch } from "./match";
import { createEventFromMessage } from "./create-event";
import { attachMessageToEvent } from "./attach-to-event";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import { getLocality } from "@/lib/target-locality";
import {
  getString,
  getOptionalString,
  getOptionalBoolean,
  getStringArray,
  getNumberArray,
  getArray,
  isFeatureCollection,
  getStreetArray,
  getStringOrDateOrNull,
} from "@/lib/record-fields";

export { computeMatchScore, type MatchSignals } from "./score";
export { findCandidateEvents } from "./candidates";
export { findBestMatch, type FindBestMatchResult, type FindBestMatchOutput } from "./match";
export { createEventFromMessage } from "./create-event";
export { attachMessageToEvent } from "./attach-to-event";
export { preGeocodeMatch, type PreGeocodeMatchResult } from "./pre-geocode-match";
export { verifyEventMatch } from "./llm-verify";

export interface EventMatchResult {
  eventId: string;
  action: "created" | "attached";
  confidence: number;
  llmVerified?: boolean;
  candidateCount: number;
}

/**
 * Main entry point for event matching.
 * Called after a message is finalized with geoJson.
 * Either creates a new event or attaches the message to an existing one.
 */
export async function processEventMatching(
  db: OboDb,
  message: Record<string, unknown>,
): Promise<EventMatchResult> {
  const messageId = getString(message._id);

  // Extract GeoJSON with structural check
  const geoJson: GeoJSONFeatureCollection | null = isFeatureCollection(message.geoJson)
    ? message.geoJson
    : null;

  const matchInput = {
    geoJson,
    timespanStart: getStringOrDateOrNull(message.timespanStart),
    timespanEnd: getStringOrDateOrNull(message.timespanEnd),
    categories: getStringArray(message.categories),
    cityWide: getOptionalBoolean(message.cityWide),
    locality: getString(message.locality) || getLocality(),
    embedding: getNumberArray(message.embedding),
    text: getOptionalString(message.text),
    plainText: getOptionalString(message.plainText),
    streets: getStreetArray(message.streets),
  };

  const { match: bestMatch, candidateCount } = await findBestMatch(db, matchInput);

  if (bestMatch) {
    const eventId = getString(bestMatch.event._id);

    await attachMessageToEvent(
      db,
      {
        _id: messageId,
        geoJson: isFeatureCollection(message.geoJson) ? message.geoJson : null,
        timespanStart: getStringOrDateOrNull(message.timespanStart),
        timespanEnd: getStringOrDateOrNull(message.timespanEnd),
        source: getOptionalString(message.source),
        categories: getStringArray(message.categories),
        embedding: getNumberArray(message.embedding),
      },
      bestMatch.event,
      bestMatch.score,
      bestMatch.signals,
    );

    logger.info("Message attached to existing event", {
      messageId,
      eventId,
      confidence: bestMatch.score,
      llmVerified: bestMatch.llmVerified ?? false,
    });

    return {
      eventId,
      action: "attached",
      confidence: bestMatch.score,
      llmVerified: bestMatch.llmVerified,
      candidateCount,
    };
  }

  // No match found — create a new event
  const { eventId, confidence, action } = await createEventFromMessage(db, {
    _id: messageId,
    plainText: getOptionalString(message.plainText),
    text: getOptionalString(message.text),
    markdownText: getOptionalString(message.markdownText),
    geoJson: isFeatureCollection(message.geoJson) ? message.geoJson : null,
    timespanStart: getStringOrDateOrNull(message.timespanStart),
    timespanEnd: getStringOrDateOrNull(message.timespanEnd),
    categories: getStringArray(message.categories),
    source: getOptionalString(message.source),
    locality: getString(message.locality) || getLocality(),
    cityWide: getOptionalBoolean(message.cityWide),
    embedding: getNumberArray(message.embedding),
    pins: getArray(message.pins),
    streets: getArray(message.streets),
    cadastralProperties: getArray(message.cadastralProperties),
    busStops: getStringArray(message.busStops),
  });

  logger.info("New event created for message", {
    messageId,
    eventId,
    action,
  });

  return { eventId, action, confidence, candidateCount };
}
