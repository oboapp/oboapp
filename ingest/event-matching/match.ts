import type { OboDb } from "@oboapp/db";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import { findCandidateEvents } from "./candidates";
import { computeMatchScore, type MatchSignals } from "./score";
import { MATCH_THRESHOLD, LLM_VERIFY_LOWER } from "./constants";
import { verifyEventMatch } from "./llm-verify";
import { logger } from "@/lib/logger";
import {
  getString,
  getOptionalString,
  getOptionalBoolean,
  getStringArray,
  getNumberArray,
  isFeatureCollection,
} from "@/lib/record-fields";

/**
 * Find the best matching event for a message, if any.
 * - Score >= MATCH_THRESHOLD (0.70): auto-match
 * - Score in [LLM_VERIFY_LOWER, MATCH_THRESHOLD) (0.55–0.70): ask LLM to verify
 * - Score < LLM_VERIFY_LOWER (0.55): no match
 *
 * Returns a {@link FindBestMatchOutput} object containing:
 * - `match`: a {@link FindBestMatchResult} with the matched event and its score,
 *   or `null` if no match is selected.
 * - `candidateCount`: the total number of candidate events considered (always present,
 *   even when `match` is `null`).
 */
export interface FindBestMatchResult {
  event: Record<string, unknown>;
  score: number;
  signals: MatchSignals;
  llmVerified?: boolean;
}

export interface FindBestMatchOutput {
  match: FindBestMatchResult | null;
  candidateCount: number;
}

export async function findBestMatch(
  db: OboDb,
  message: {
    geoJson?: GeoJSONFeatureCollection | null;
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
    categories?: string[];
    cityWide?: boolean;
    locality: string;
    embedding?: number[] | null;
    text?: string;
    plainText?: string;
    streets?: Array<{ street: string }>;
  },
): Promise<FindBestMatchOutput> {
  const candidates = await findCandidateEvents(db, message);

  if (candidates.length === 0) return { match: null, candidateCount: 0 };

  let bestMatch: {
    event: Record<string, unknown>;
    score: number;
    signals: MatchSignals;
  } | null = null;

  for (const candidate of candidates) {
    const { score, signals } = computeMatchScore(
      {
        geoJson: message.geoJson,
        timespanStart: message.timespanStart,
        timespanEnd: message.timespanEnd,
        categories: message.categories,
        cityWide: message.cityWide,
        embedding: message.embedding ?? undefined,
      },
      {
        geoJson: isFeatureCollection(candidate.geoJson) ? candidate.geoJson : null,
        timespanStart: getOptionalString(candidate.timespanStart) ?? null,
        timespanEnd: getOptionalString(candidate.timespanEnd) ?? null,
        categories: getStringArray(candidate.categories),
        cityWide: getOptionalBoolean(candidate.cityWide),
        embedding: getNumberArray(candidate.embedding),
      },
    );

    if (score >= LLM_VERIFY_LOWER && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { event: candidate, score, signals };
    }
  }

  if (!bestMatch) return { match: null, candidateCount: candidates.length };

  // High-confidence match — auto-attach
  if (bestMatch.score >= MATCH_THRESHOLD) {
    return { match: bestMatch, candidateCount: candidates.length };
  }

  // Uncertain zone (LLM_VERIFY_LOWER to MATCH_THRESHOLD) — ask LLM
  const messageText = message.plainText || message.text || "";
  const eventText =
    getString(bestMatch.event.plainText) ||
    getString(bestMatch.event.markdownText) ||
    "";

  if (!messageText || !eventText) {
    logger.info("LLM verify skipped: missing text for comparison", {
      hasMessageText: Boolean(messageText),
      hasEventText: Boolean(eventText),
    });
    return { match: null, candidateCount: candidates.length };
  }

  const locationContext = buildLocationContext(message, bestMatch.event);
  const timeContext = buildTimeContext(message, bestMatch.event);

  const llmResult = await verifyEventMatch({
    messageText,
    eventText,
    locationContext,
    timeContext,
  });

  if (llmResult?.isSameEvent) {
    logger.info("LLM verified event match", {
      score: bestMatch.score,
      reasoning: llmResult.reasoning,
    });
    return { match: { ...bestMatch, llmVerified: true }, candidateCount: candidates.length };
  }

  // LLM rejected or failed — treat as no match (conservative)
  logger.info("LLM rejected or failed event match", {
    score: bestMatch.score,
    reasoning: llmResult?.reasoning ?? "LLM call failed",
    isSameEvent: llmResult?.isSameEvent,
  });
  return { match: null, candidateCount: candidates.length };
}

function buildLocationContext(
  message: { geoJson?: GeoJSONFeatureCollection | null; cityWide?: boolean; streets?: Array<{ street: string }> },
  event: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (message.cityWide) parts.push("Message: city-wide");
  if (event.cityWide) parts.push("Event: city-wide");

  const streetNames = message.streets?.map((s) => s.street).filter(Boolean);
  if (streetNames?.length) {
    parts.push(`Streets: ${streetNames.join(", ")}`);
  }

  return parts.join("; ") || "";
}

function buildTimeContext(
  message: {
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
  },
  event: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (message.timespanStart || message.timespanEnd) {
    parts.push(
      `Message: ${message.timespanStart ?? "?"} to ${message.timespanEnd ?? "?"}`,
    );
  }
  if (event.timespanStart || event.timespanEnd) {
    parts.push(
      `Event: ${event.timespanStart ?? "?"} to ${event.timespanEnd ?? "?"}`,
    );
  }
  return parts.join("; ") || "";
}
