/** Matching threshold — score above this means "same event" */
export const MATCH_THRESHOLD = 0.7;

/** Time window for candidate search (days before/after message timespan) */
export const CANDIDATE_TIME_WINDOW_DAYS = 2;

/** Maximum distance in meters for location similarity consideration */
export const CANDIDATE_DISTANCE_METERS = 500;

/** Weight for location similarity in composite score */
export const LOCATION_WEIGHT = 0.35;

/** Weight for temporal overlap in composite score */
export const TIME_WEIGHT = 0.25;

/** Weight for text similarity (embedding cosine) in composite score */
export const TEXT_WEIGHT = 0.25;

/** Weight for category match in composite score */
export const CATEGORY_WEIGHT = 0.15;

/** Fallback weights when embeddings are unavailable (Phase 2 formula) */
export const FALLBACK_LOCATION_WEIGHT = 0.5;
export const FALLBACK_TIME_WEIGHT = 0.35;
export const FALLBACK_CATEGORY_WEIGHT = 0.15;

/** LLM verification lower bound — scores below this are always a new event */
export const LLM_VERIFY_LOWER = 0.55;

/** Pre-geocode matching: higher threshold (no spatial comparison) */
export const PRE_GEOCODE_MATCH_THRESHOLD = 0.8;

/** Pre-geocode matching: lower threshold when embeddings are available */
export const PRE_GEOCODE_MATCH_THRESHOLD_WITH_EMBEDDINGS = 0.75;

/** Minimum geometry quality on an event to reuse its geometry (skip geocoding) */
export const MIN_REUSABLE_GEOMETRY_QUALITY = 2;

/** Pre-geocode scoring weights (time + category only, no location) */
export const PRE_GEOCODE_TIME_WEIGHT = 0.7;
export const PRE_GEOCODE_CATEGORY_WEIGHT = 0.3;

/** Pre-geocode scoring weights when embeddings are available */
export const PRE_GEOCODE_TIME_WEIGHT_WITH_EMBEDDINGS = 0.45;
export const PRE_GEOCODE_CATEGORY_WEIGHT_WITH_EMBEDDINGS = 0.2;
export const PRE_GEOCODE_TEXT_WEIGHT = 0.35;
