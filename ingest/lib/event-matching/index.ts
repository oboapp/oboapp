import { logger } from "@/lib/logger";
import type { OboDb } from "@oboapp/db";
import { findBestMatch } from "./match";
import { createEventFromMessage } from "./create-event";
import { attachMessageToEvent } from "./attach-to-event";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import { getLocality } from "@/lib/target-locality";

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
  const messageId = message._id as string;

  const matchInput = {
    geoJson: message.geoJson as GeoJSONFeatureCollection | null,
    timespanStart: message.timespanStart as string | null,
    timespanEnd: message.timespanEnd as string | null,
    categories: message.categories as string[] | undefined,
    cityWide: message.cityWide as boolean | undefined,
    locality: (message.locality as string) || getLocality(),
    embedding: message.embedding as number[] | undefined,
    text: message.text as string | undefined,
    plainText: message.plainText as string | undefined,
    streets: message.streets as Array<{ street: string }> | undefined,
  };

  const { match: bestMatch, candidateCount } = await findBestMatch(db, matchInput);

  if (bestMatch) {
    const eventId = bestMatch.event._id as string;

    await attachMessageToEvent(
      db,
      {
        _id: messageId,
        geoJson: message.geoJson as GeoJSONFeatureCollection | null,
        timespanStart: message.timespanStart as string | null,
        timespanEnd: message.timespanEnd as string | null,
        source: message.source as string | undefined,
        categories: message.categories as string[] | undefined,
        embedding: message.embedding as number[] | undefined,
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
    plainText: message.plainText as string | undefined,
    text: message.text as string | undefined,
    markdownText: message.markdownText as string | undefined,
    geoJson: message.geoJson as GeoJSONFeatureCollection | null,
    timespanStart: message.timespanStart as string | null,
    timespanEnd: message.timespanEnd as string | null,
    categories: message.categories as string[] | undefined,
    source: message.source as string | undefined,
    locality: (message.locality as string) || getLocality(),
    cityWide: message.cityWide as boolean | undefined,
    embedding: message.embedding as number[] | undefined,
    pins: message.pins as unknown[] | undefined,
    streets: message.streets as unknown[] | undefined,
    cadastralProperties: message.cadastralProperties as unknown[] | undefined,
    busStops: message.busStops as string[] | undefined,
  });

  logger.info("New event created for message", {
    messageId,
    eventId,
    action,
  });

  return { eventId, action, confidence, candidateCount };
}
