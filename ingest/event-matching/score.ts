import * as turf from "@turf/turf";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import {
  LOCATION_WEIGHT,
  TIME_WEIGHT,
  TEXT_WEIGHT,
  CATEGORY_WEIGHT,
  FALLBACK_LOCATION_WEIGHT,
  FALLBACK_TIME_WEIGHT,
  FALLBACK_CATEGORY_WEIGHT,
  CANDIDATE_DISTANCE_METERS,
} from "./constants";
import { cosineSimilarity } from "./cosine-similarity";
import { toMs } from "./utils";

export interface MatchSignals {
  locationSimilarity: number;
  timeOverlap: number;
  categoryMatch: number;
  textSimilarity: number;
}

/**
 * Compute composite match score between a message and a candidate event.
 * Returns a score from 0 (no match) to 1 (perfect match) and the individual signals.
 */
export function computeMatchScore(
  message: {
    geoJson?: GeoJSONFeatureCollection | null;
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
    categories?: string[];
    cityWide?: boolean;
    embedding?: number[] | null;
  },
  event: {
    geoJson?: GeoJSONFeatureCollection | null;
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
    categories?: string[];
    cityWide?: boolean;
    embedding?: number[] | null;
  },
): { score: number; signals: MatchSignals } {
  const locationSimilarity = computeLocationSimilarity(
    message.geoJson,
    event.geoJson,
    message.cityWide,
    event.cityWide,
  );
  const timeOverlap = computeTimeOverlap(
    message.timespanStart,
    message.timespanEnd,
    event.timespanStart,
    event.timespanEnd,
  );
  const categoryMatch = computeCategoryMatch(
    message.categories,
    event.categories,
  );

  const hasEmbeddings = Boolean(
    message.embedding?.length && event.embedding?.length,
  );

  let textSimilarity = 0;
  let score: number;

  if (hasEmbeddings) {
    // Cosine similarity returns [-1, 1]; clamp to [0, 1] for scoring.
    // Guard against NaN (e.g. if stored embeddings contain non-finite values).
    // Also clamp upper bound: floating-point error can push cosine slightly above 1.
    const raw = cosineSimilarity(message.embedding!, event.embedding!);
    textSimilarity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;

    score =
      LOCATION_WEIGHT * locationSimilarity +
      TIME_WEIGHT * timeOverlap +
      TEXT_WEIGHT * textSimilarity +
      CATEGORY_WEIGHT * categoryMatch;
  } else {
    // Graceful fallback: use Phase 2 weights (no text signal)
    score =
      FALLBACK_LOCATION_WEIGHT * locationSimilarity +
      FALLBACK_TIME_WEIGHT * timeOverlap +
      FALLBACK_CATEGORY_WEIGHT * categoryMatch;
  }

  return {
    score,
    signals: { locationSimilarity, timeOverlap, categoryMatch, textSimilarity },
  };
}

/**
 * Location similarity: inverse of centroid distance.
 * 0 at ≥CANDIDATE_DISTANCE_METERS, 1 at 0m.
 * City-wide messages skip spatial comparison (returns 1.0 when both are city-wide).
 */
function computeLocationSimilarity(
  messageGeoJson: GeoJSONFeatureCollection | null | undefined,
  eventGeoJson: GeoJSONFeatureCollection | null | undefined,
  messageCityWide?: boolean,
  eventCityWide?: boolean,
): number {
  // City-wide: spatial comparison not meaningful
  if (messageCityWide && eventCityWide) return 1.0;

  if (!messageGeoJson?.features?.length || !eventGeoJson?.features?.length) {
    return 0;
  }

  // Safety: skip if any feature has null/missing geometry (turf.centroid would throw)
  const hasValidGeometry = (fc: GeoJSONFeatureCollection) =>
    fc.features.every((f) => f.geometry?.type && f.geometry?.coordinates);
  if (!hasValidGeometry(messageGeoJson) || !hasValidGeometry(eventGeoJson)) {
    return 0;
  }

  const msgCentroid = turf.centroid(messageGeoJson);
  const evtCentroid = turf.centroid(eventGeoJson);

  const distanceMeters =
    turf.distance(msgCentroid, evtCentroid, { units: "meters" });

  if (distanceMeters >= CANDIDATE_DISTANCE_METERS) return 0;
  return 1 - distanceMeters / CANDIDATE_DISTANCE_METERS;
}

/**
 * Temporal overlap: ratio of overlapping time to the union of both timespans.
 * Returns 1 if timespans are identical, 0 if no overlap.
 * If either timespan is missing, returns 0.
 */
function computeTimeOverlap(
  msgStart: string | Date | null | undefined,
  msgEnd: string | Date | null | undefined,
  evtStart: string | Date | null | undefined,
  evtEnd: string | Date | null | undefined,
): number {
  if (!msgStart || !msgEnd || !evtStart || !evtEnd) return 0;

  const ms = toMs(msgStart);
  const me = toMs(msgEnd);
  const es = toMs(evtStart);
  const ee = toMs(evtEnd);

  // If any value is NaN (invalid date string), treat as no overlap
  if (!Number.isFinite(ms) || !Number.isFinite(me) || !Number.isFinite(es) || !Number.isFinite(ee)) return 0;

  const overlapStart = Math.max(ms, es);
  const overlapEnd = Math.min(me, ee);
  const overlap = Math.max(0, overlapEnd - overlapStart);

  if (overlap === 0) return 0;

  const union = Math.max(me, ee) - Math.min(ms, es);
  if (union === 0) return 1; // identical instants

  return overlap / union;
}

/**
 * Category match: Jaccard similarity of category arrays.
 * Returns 0 if either array is empty (neutral — not a penalty).
 */
function computeCategoryMatch(
  msgCategories?: string[],
  evtCategories?: string[],
): number {
  const a = msgCategories ?? [];
  const b = evtCategories ?? [];

  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;

  return intersection / union;
}

