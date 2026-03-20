import type { OboDb } from "@oboapp/db";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import { findCandidateEvents } from "./candidates";
import { computeMatchScore, type MatchSignals } from "./score";
import { cosineSimilarity } from "./cosine-similarity";
import {
  PRE_GEOCODE_MATCH_THRESHOLD,
  PRE_GEOCODE_MATCH_THRESHOLD_WITH_EMBEDDINGS,
  MIN_REUSABLE_GEOMETRY_QUALITY,
  PRE_GEOCODE_TIME_WEIGHT,
  PRE_GEOCODE_CATEGORY_WEIGHT,
  PRE_GEOCODE_TIME_WEIGHT_WITH_EMBEDDINGS,
  PRE_GEOCODE_CATEGORY_WEIGHT_WITH_EMBEDDINGS,
  PRE_GEOCODE_TEXT_WEIGHT,
} from "./constants";
import {
  getNumber,
  getOptionalBoolean,
  getStringArray,
  getNumberArray,
  isFeatureCollection,
  getStringOrDateOrNull,
} from "@/lib/record-fields";

export interface PreGeocodeMatchResult {
  event: Record<string, unknown>;
  geometry: GeoJSONFeatureCollection;
  score: number;
  signals: MatchSignals;
}

/**
 * Attempt to match a message to an existing event BEFORE geocoding.
 * If a high-quality match is found, reuse the event's geometry and skip geocoding.
 *
 * Uses only time+category signals (no spatial comparison since geoJson doesn't exist yet).
 * Requires a higher threshold (0.80) and minimum geometry quality (≥2) on the event.
 *
 * Returns null if no suitable match found — caller should proceed with normal geocoding.
 */
export async function preGeocodeMatch(
  db: OboDb,
  message: {
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
    categories?: string[];
    cityWide?: boolean;
    locality: string;
    embedding?: number[] | null;
  },
): Promise<PreGeocodeMatchResult | null> {
  const candidates = await findCandidateEvents(db, message);

  if (candidates.length === 0) return null;

  let best: PreGeocodeMatchResult | null = null;

  for (const candidate of candidates) {
    const geometryQuality = getNumber(candidate.geometryQuality);

    // Skip events with low-quality geometry — not worth reusing
    if (geometryQuality < MIN_REUSABLE_GEOMETRY_QUALITY) continue;

    const geometry = isFeatureCollection(candidate.geoJson) ? candidate.geoJson : undefined;
    if (!geometry?.features?.length) continue;

    // Score using time + category only (re-weighted since no location signal)
    const { signals } = computeMatchScore(
      {
        geoJson: null, // no geoJson yet
        timespanStart: message.timespanStart,
        timespanEnd: message.timespanEnd,
        categories: message.categories,
        cityWide: message.cityWide,
      },
      {
        geoJson: isFeatureCollection(candidate.geoJson) ? candidate.geoJson : null,
        timespanStart: getStringOrDateOrNull(candidate.timespanStart),
        timespanEnd: getStringOrDateOrNull(candidate.timespanEnd),
        categories: getStringArray(candidate.categories),
        cityWide: getOptionalBoolean(candidate.cityWide),
      },
    );

    const candidateEmbedding = getNumberArray(candidate.embedding);
    const hasEmbeddings = Boolean(
      message.embedding?.length && candidateEmbedding?.length,
    );

    let score: number;
    let threshold: number;

    if (hasEmbeddings) {
      const raw = cosineSimilarity(
        message.embedding!,
        candidateEmbedding!,
      );
      // Guard against NaN (e.g. if stored embeddings contain non-finite values).
      // Also clamp upper bound: floating-point error can push cosine slightly above 1.
      const textSimilarity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      signals.textSimilarity = textSimilarity;

      score =
        PRE_GEOCODE_TIME_WEIGHT_WITH_EMBEDDINGS * signals.timeOverlap +
        PRE_GEOCODE_CATEGORY_WEIGHT_WITH_EMBEDDINGS * signals.categoryMatch +
        PRE_GEOCODE_TEXT_WEIGHT * textSimilarity;
      threshold = PRE_GEOCODE_MATCH_THRESHOLD_WITH_EMBEDDINGS;
    } else {
      score =
        PRE_GEOCODE_TIME_WEIGHT * signals.timeOverlap +
        PRE_GEOCODE_CATEGORY_WEIGHT * signals.categoryMatch;
      threshold = PRE_GEOCODE_MATCH_THRESHOLD;
    }

    if (score >= threshold && (!best || score > best.score)) {
      best = { event: candidate, geometry, score, signals };
    }
  }

  return best;
}
