import {
  Address,
  OverpassResponse,
  OverpassGeometry,
  Coordinates,
} from "../../lib/types";
import { AsyncLocalStorage } from "node:async_hooks";
import * as turf from "@turf/turf";
import type { Feature, MultiLineString, Position } from "geojson";
import {
  getLocalityBounds,
  getLocalityCenter,
  getLocalityBbox,
} from "../google/utils";
import { isWithinBounds } from "@oboapp/shared";
import { getLocality } from "../../lib/target-locality";
import { delay } from "../../lib/delay";
import { roundCoordinate } from "@/geocoding/shared/coordinate-utils";
import { logger } from "@/lib/logger";
import { gradeOverpass } from "../shared/quality";
import { OverpassMockService } from "../../__mocks__/services/overpass-mock-service";

// Check if mocking is enabled
const USE_MOCK = process.env.MOCK_OVERPASS_API === "true";
const mockService = USE_MOCK ? new OverpassMockService() : null;

const APP_URL_ENV = process.env.APP_URL;
if (!APP_URL_ENV && process.env.NODE_ENV === "production") {
  throw new Error("Environment variable APP_URL must be set in production.");
}
const APP_URL = APP_URL_ENV ?? "http://localhost:3000";

// Constants for API rate limiting
const OVERPASS_DELAY_MS = 500; // 500ms for Overpass API (generous limits)
const OVERPASS_TIMEOUT_MS = 25000; // 25 seconds timeout for HTTP requests
const BUFFER_DISTANCE_METERS = 30; // Buffer distance for street geometries

// Adaptive retry policy for per-instance 429 / AbortError retries
export const OVERPASS_RETRY_MAX_ATTEMPTS = 3; // Total attempts per instance (including first)
export const OVERPASS_RETRY_BASE_DELAY_MS = 1_000;
export const OVERPASS_RETRY_MAX_DELAY_MS = 30_000;
const OVERPASS_RETRY_BACKOFF_FACTOR = 2;
const OVERPASS_RETRY_JITTER_FACTOR = 0.25;

// Number of consecutive per-street transient failures (i.e. streets that exhausted every
// instance) needed to open the circuit. One increment per street, not per individual request.
export const CIRCUIT_BREAKER_THRESHOLD = 5;

type StreetGeometryFeatureType = "street" | "boulevard" | "square";

/**
 * Build a cache key that encodes both the query variant and the normalized
 * street name, preventing collisions between lookups that use different
 * Overpass queries for the same normalized name
 * (e.g. "ул. България" uses a wider highway filter than "бул. България").
 */
function makeStreetGeometryCacheKey(
  featureType: StreetGeometryFeatureType,
  normalizedStreetName: string,
): string {
  return `${featureType}:${normalizedStreetName}`;
}

function getStreetFeatureType(streetName: string): StreetGeometryFeatureType {
  const lower = streetName.toLowerCase();
  if (Boolean(lower.match(/^(площад|пл\.)\s*/))) return "square";
  if (lower.includes("бул.")) return "boulevard";
  if (lower.includes("ул.")) return "street";
  return "boulevard";
}

// In-memory cache for street geometry lookups (keyed on type + normalized street name)
const streetGeometryCache = new Map<string, Feature<MultiLineString> | null>();

interface OverpassRunContext {
  deferredKeys: Set<string>;
  consecutiveTransientFailures: number;
  circuitOpen: boolean;
}

const runContextStorage = new AsyncLocalStorage<OverpassRunContext>();

function getRunContext(): OverpassRunContext | undefined {
  return runContextStorage.getStore();
}

function recordTransientFailure(ctx: OverpassRunContext): void {
  ctx.consecutiveTransientFailures++;
  if (
    ctx.consecutiveTransientFailures >= CIRCUIT_BREAKER_THRESHOLD &&
    !ctx.circuitOpen
  ) {
    ctx.circuitOpen = true;
    logger.warn(
      "Overpass circuit breaker opened after consecutive transient failures",
      {
        threshold: CIRCUIT_BREAKER_THRESHOLD,
      },
    );
  }
}

function recordSuccess(ctx: OverpassRunContext): void {
  if (ctx.consecutiveTransientFailures > 0 || ctx.circuitOpen) {
    if (ctx.circuitOpen) {
      logger.info("Overpass circuit breaker closed after successful request");
    }
    ctx.consecutiveTransientFailures = 0;
    ctx.circuitOpen = false;
  }
}

export function parseRetryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;

  // Delta-seconds format: "42"
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Math.min(seconds * 1_000, OVERPASS_RETRY_MAX_DELAY_MS);
  }

  // HTTP-date format (RFC 7231 IMF-fixdate only): "Sat, 05 Apr 2026 12:34:56 GMT"
  // Reject anything that isn't a strict IMF-fixdate to avoid accepting ISO 8601 or
  // other Date.parse-parseable strings that aren't valid Retry-After values.
  if (
    !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)
  )
    return null;
  const retryAtMs = Date.parse(trimmed);
  if (Number.isNaN(retryAtMs)) return null;
  return Math.min(
    Math.max(retryAtMs - Date.now(), 0),
    OVERPASS_RETRY_MAX_DELAY_MS,
  );
}

export function calculateRetryDelayMs(
  attempt: number,
  retryAfterMs: number | null,
): number {
  if (retryAfterMs !== null)
    return Math.min(retryAfterMs, OVERPASS_RETRY_MAX_DELAY_MS);
  const base =
    OVERPASS_RETRY_BASE_DELAY_MS *
    Math.pow(OVERPASS_RETRY_BACKOFF_FACTOR, attempt - 1);
  const jitter = base * OVERPASS_RETRY_JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.min(Math.round(base + jitter), OVERPASS_RETRY_MAX_DELAY_MS);
}

function getStreetGeometryCacheKey(streetName: string): string {
  return makeStreetGeometryCacheKey(
    getStreetFeatureType(streetName),
    normalizeStreetName(streetName),
  );
}

/** Clear the street geometry cache. Exported for test isolation. */
export function clearStreetGeometryCache(): void {
  streetGeometryCache.clear();
}

/**
 * Return a street geometry from the in-memory cache without making a network request.
 * Returns null if the geometry was not fetched in the current run.
 */
export function getStreetGeometryCached(
  streetName: string,
): Feature<MultiLineString> | null {
  const cacheKey = getStreetGeometryCacheKey(streetName);
  return streetGeometryCache.get(cacheKey) ?? null;
}

/**
 * Returns true if Overpass has already been queried for this street in the current run
 * (regardless of whether it was found or not). Used to determine whether a rate-limiting
 * delay is needed before a subsequent Overpass call.
 */
export function hasStreetGeometryQueried(streetName: string): boolean {
  const cacheKey = getStreetGeometryCacheKey(streetName);
  const ctx = getRunContext();
  return (
    streetGeometryCache.has(cacheKey) ||
    Boolean(ctx?.deferredKeys.has(cacheKey))
  );
}

/**
 * Pre-populate the in-memory street geometry cache from externally stored entries
 * (e.g. the geocode cache DB collection). Entries already present are not overwritten.
 */
export function seedStreetGeometryCache(
  entries: Array<{ originalName: string; geometry: Feature<MultiLineString> }>,
): void {
  for (const { originalName, geometry } of entries) {
    const cacheKey = makeStreetGeometryCacheKey(
      getStreetFeatureType(originalName),
      normalizeStreetName(originalName),
    );
    if (!streetGeometryCache.has(cacheKey)) {
      streetGeometryCache.set(cacheKey, geometry);
    }
  }
}

/**
 * Pre-fetch street geometries for a batch of names, populating the in-memory cache
 * before intersection geocoding begins.
 *
 * Deduplicates by full cache key (inferred feature type + normalised street name) so
 * each unique query variant is fetched at most once — e.g. "\u0443\u043b. \u041e\u0431\u043e\u0440\u0438\u0449\u0435" (street) and
 * "\u0431\u0443\u043b. \u041e\u0431\u043e\u0440\u0438\u0449\u0435" (boulevard) produce different keys and are each fetched once.
 * Runs an internal two-pass retry (identical in structure to overpassGeocodeIntersections):
 * streets that fail transiently in the first pass are retried once.  Streets still
 * deferred after the retry pass are written into the cache as null, which converts
 * future lookups into immediate cache hits and prevents repeated Overpass calls for the
 * same unavailable street across multiple sections.
 *
 * Includes OVERPASS_DELAY_MS between requests (Overpass rate-limiting constraint).
 */
/**
 * PRECONDITION: must not be called from within an existing runWithDeferredRetryScope.
 * The function creates its own isolated scope and calls clearDeferredStreetGeometryKeys()
 * internally; if an outer scope exists those calls would corrupt its deferred-key state,
 * breaking the outer retry logic. A defensive guard is applied at runtime.
 */
export async function preFetchStreetGeometries(
  streetNames: string[],
): Promise<void> {
  if (getRunContext() !== undefined) {
    logger.warn(
      "preFetchStreetGeometries called inside an existing retry scope — skipping pre-fetch",
    );
    return;
  }

  // Deduplicate by cache key; skip names already resolved (success, null, or pending dedup)
  const keyToName = new Map<string, string>();
  for (const name of streetNames) {
    if (!name.trim()) continue;
    const key = getStreetGeometryCacheKey(name);
    if (keyToName.has(key) || streetGeometryCache.has(key)) continue;
    keyToName.set(key, name);
  }

  if (keyToName.size === 0) return;

  const toFetch = [...keyToName.values()];
  logger.debug("Pre-fetching street geometries", { count: toFetch.length });

  await runWithDeferredRetryScope(async () => {
    // First pass: fetch each unique name
    for (let i = 0; i < toFetch.length; i++) {
      if (i > 0) await delay(OVERPASS_DELAY_MS);
      await getStreetGeometryFromOverpass(toFetch[i]);
    }

    // Second pass: retry names that were deferred by transient failures
    const ctx = getRunContext();
    if (!ctx || ctx.deferredKeys.size === 0) return;

    // Snapshot before clearing — clearDeferredStreetGeometryKeys empties the Set
    const deferredKeys = [...ctx.deferredKeys];
    const deferredNames = deferredKeys
      .map((k) => keyToName.get(k))
      .filter((n): n is string => n !== undefined);
    const unknownDeferredCount = deferredKeys.filter(
      (k) => !keyToName.has(k),
    ).length;

    clearDeferredStreetGeometryKeys();

    if (unknownDeferredCount > 0) {
      logger.warn(
        "preFetchStreetGeometries: deferred keys with no matching name — streets will not be retried",
        { count: unknownDeferredCount },
      );
    }

    logger.debug("Retrying deferred street geometry pre-fetches", {
      count: deferredNames.length,
    });

    // Respect rate limiting between the last request of pass 1 and the first of pass 2
    if (deferredNames.length > 0) await delay(OVERPASS_DELAY_MS);

    for (let i = 0; i < deferredNames.length; i++) {
      if (i > 0) await delay(OVERPASS_DELAY_MS);
      await getStreetGeometryFromOverpass(deferredNames[i]);
    }

    // Any streets still deferred after retry are unlikely to succeed in the current run.
    // Cache them as null so that subsequent intersection processing gets an immediate
    // cache hit instead of issuing another Overpass request per section.
    const ctxAfterRetry = getRunContext();
    if (ctxAfterRetry && ctxAfterRetry.deferredKeys.size > 0) {
      logger.debug("Marking persistently unavailable streets in cache", {
        count: ctxAfterRetry.deferredKeys.size,
      });
      for (const key of ctxAfterRetry.deferredKeys) {
        streetGeometryCache.set(key, null);
      }
      ctxAfterRetry.deferredKeys.clear();
    }
  });
}

function isStreetGeometryDeferred(streetName: string): boolean {
  const ctx = getRunContext();
  return Boolean(ctx?.deferredKeys.has(getStreetGeometryCacheKey(streetName)));
}

function clearDeferredStreetGeometryKeys(): void {
  const ctx = getRunContext();
  if (ctx) {
    ctx.deferredKeys.clear();
    // Reset circuit breaker for the retry pass so deferred streets get a fair attempt
    ctx.consecutiveTransientFailures = 0;
    ctx.circuitOpen = false;
  }
}

async function runWithDeferredRetryScope<T>(
  work: () => Promise<T>,
): Promise<T> {
  const existingScope = runContextStorage.getStore();
  if (existingScope !== undefined) {
    return work();
  }

  const ctx: OverpassRunContext = {
    deferredKeys: new Set<string>(),
    consecutiveTransientFailures: 0,
    circuitOpen: false,
  };
  return runContextStorage.run(ctx, work);
}

function parseIntersectionStreetNames(intersection: string): [string, string] {
  const [street1Name = "", street2Name = ""] = intersection
    .split("\u2229")
    .map((s) => s.trim());
  return [street1Name, street2Name];
}

function shouldRetryIntersectionLater(intersection: string): boolean {
  const [street1Name, street2Name] = parseIntersectionStreetNames(intersection);
  return (
    (Boolean(street1Name) && isStreetGeometryDeferred(street1Name)) ||
    (Boolean(street2Name) && isStreetGeometryDeferred(street2Name))
  );
}

/**
 * Parse Overpass XML error response to extract error message
 */
function parseOverpassError(responseText: string): string | null {
  const remarkMatch = /<remark>\s*([\s\S]+?)\s*<\/remark>/.exec(responseText);
  if (remarkMatch) {
    return remarkMatch[1].trim();
  }
  return null;
}

/**
 * Determine if error is client-side (our query problem) or server-side (should retry)
 */
function shouldTryFallback(error: Error, statusCode?: number): boolean {
  const msg = error.message.toLowerCase();

  // Client-side errors (our fault) - don't retry
  if (
    msg.includes("syntax") ||
    msg.includes("parse error") ||
    msg.includes("expected") ||
    msg.includes("unexpected") ||
    msg.includes("invalid")
  ) {
    return false;
  }

  // HTTP 4xx = client error (except 429 Too Many Requests and 406 Not Acceptable).
  // 406 is treated as an instance-level rejection (e.g. missing User-Agent, fair-use
  // policy) rather than a query error, so we still try the fallback instance.
  if (
    statusCode &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 429 &&
    statusCode !== 406
  ) {
    return false;
  }

  // All other errors = server-side, should retry
  return true;
}

type ErrorWithStatusCode = Error & { statusCode?: number };

// Multiple Overpass API instances for fallback
export const OVERPASS_INSTANCES = [
  "https://overpass.private.coffee/api/interpreter", // No rate limit
  "https://overpass-api.de/api/interpreter", // Main instance (10k queries/day)
];

/**
 * Normalize street name for better OSM matching
 * - Removes street type prefixes (бул., ул., площад, пл.)
 * - Removes Bulgarian ordinal suffixes from numbers (20-ти → 20, 3-ти → 3)
 * - Removes all quote styles (ASCII and Unicode)
 * - Normalizes whitespace
 */
export function normalizeStreetName(streetName: string): string {
  return streetName
    .toLowerCase()
    .replaceAll(/^(бул\.|ул\.|площад|пл\.)\s*/g, "")
    .replaceAll(/(?<=\d)-(?:ти|ви|и|ри|ма|то)(?=\s|$|[^а-яa-z])/gi, "") // Strip ordinal suffixes: 20-ти → 20
    .replaceAll(/["\u201c\u201d\u201e'`\u2018\u2019\u201a«»‹›]/g, "") // Remove ALL quote styles
    .replaceAll(/\.([а-яa-z])/gi, ". $1") // Space after dot-letter: Г.С.Раковски → Г. С. Раковски
    .replaceAll(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Normalize street name for Overpass query regex construction.
 * Same as normalizeStreetName but preserves original case so that the generated
 * regex matches OSM's title-cased names.
 *
 * Background: Overpass QL's ",i" case-insensitive flag uses POSIX REG_ICASE which
 * only folds ASCII characters. Lowercase Cyrillic in a regex like
 * ["name"~"тодор каблешков",i] returns 0 results, while
 * ["name"~"Тодор Каблешков",i] correctly returns all matching ways.
 */
export function normalizeStreetNameForQuery(streetName: string): string {
  return streetName
    .replaceAll(/^(бул\.|ул\.|площад|пл\.)\s*/gi, "")
    .replaceAll(/(?<=\d)-(?:ти|ви|и|ри|ма|то)(?=\s|$|[^а-яa-z])/gi, "") // Strip ordinal suffixes: 20-ти → 20
    .replaceAll(/["\u201c\u201d\u201e'`\u2018\u2019\u201a«»‹›]/g, "") // Remove ALL quote styles
    .replaceAll(/\.([а-яa-z])/gi, ". $1") // Space after dot-letter: Г.С.Раковски → Г. С. Раковски
    .replaceAll(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Convert a normalized street name into a flexible Overpass QL regex pattern.
 * Handles OSM naming quirks:
 * - Hyphen spacing: "Данчов-Зографина" query also matches OSM "Данчов - Зографина"
 * - Ordinal suffixes: "20" query also matches OSM "20-ти", "20-ви", etc.
 * - Abbreviated names: "К. Пейчинович" query also matches OSM "Кирил Пейчинович"
 */
export function toOverpassRegex(normalizedName: string): string {
  return (
    normalizedName
      // Allow optional spaces around hyphens between letters
      .replaceAll(/([а-яa-z])-([а-яa-z])/gi, "$1( ?- ?)$2")
      // Allow optional ordinal suffix after numbers
      .replaceAll(/(\d+)/g, "$1(-(ти|ви|и|ри|ма|то))?")
      // Expand single-letter abbreviations: "к. пейчинович" → "к.*\.? пейчинович"
      // Only expands a single letter followed by ". " (not multi-letter abbreviations like "ген.")
      // Uses lookahead (?= ) so consecutive abbreviations like "г. с." both get expanded
      // Optional dot (\.?) allows matching both full and abbreviated OSM names (e.g. "Георги С. Раковски")
      // Uses "." (any char) instead of [а-я] — Overpass POSIX regex doesn't support Cyrillic ranges
      .replaceAll(/(^| )([а-яa-z])\.(?= )/gi, "$1$2.*\\.?")
  );
}

/**
 * Get street geometry from Overpass API (OpenStreetMap)
 * Returns actual LineString geometries from OSM, preserving way structure
 */
export async function getStreetGeometryFromOverpass(
  streetName: string,
): Promise<Feature<MultiLineString> | null> {
  const cacheKey = getStreetGeometryCacheKey(streetName);

  // Check the in-memory cache first — cached results are always usable regardless
  // of circuit-breaker or deferred-retry state (no network call needed).
  if (streetGeometryCache.has(cacheKey)) {
    const normalizedName = normalizeStreetName(streetName);
    logger.debug("Street geometry cache hit", { streetName, normalizedName });
    return streetGeometryCache.get(cacheKey)!;
  }

  const runCtx = getRunContext();
  const deferredKeys = runCtx?.deferredKeys;

  if (deferredKeys?.has(cacheKey)) {
    logger.debug("Street geometry deferred for retry", { streetName });
    return null;
  }

  // Circuit breaker — stop hammering Overpass when saturated
  if (runCtx?.circuitOpen) {
    deferredKeys?.add(cacheKey);
    logger.debug(
      "Overpass circuit open, deferring street without network attempt",
      {
        streetName,
      },
    );
    return null;
  }

  try {
    // Normalize street name for the Overpass regex query.
    // normalizeStreetNameForQuery preserves original case because Overpass's ,i flag
    // uses POSIX REG_ICASE which does not fold Cyrillic characters.
    const queryName = normalizeStreetNameForQuery(streetName);

    // Determine query variant — needed both for the cache key and the Overpass query.
    // "square" uses place=square OSM tags; "street" broadens the highway filter to
    // include residential/unclassified/living_street (prefixed with "ул.").
    const featureType = getStreetFeatureType(streetName);
    const isSquare = featureType === "square";
    const isStreet = featureType === "street";

    const queryRegex = toOverpassRegex(queryName);

    // Overpass QL query to find the street by name
    // For squares, search for place=square nodes/areas
    // For streets (ул.), include residential roads in addition to main highways

    let query: string;

    const bbox = getLocalityBbox();

    if (isSquare) {
      // Search for squares as nodes or ways with place=square
      query = `
        [out:json][timeout:25];
        (
          node["place"="square"]["name"~"${queryRegex}",i](${bbox});
          way["place"="square"]["name"~"${queryRegex}",i](${bbox});
          node["place"="square"]["name:bg"~"${queryRegex}",i](${bbox});
          way["place"="square"]["name:bg"~"${queryRegex}",i](${bbox});
        );
        out geom;
      `;
    } else {
      // Search for streets/boulevards
      const highwayFilter = isStreet
        ? '["highway"~"^(primary|secondary|tertiary|trunk|residential|unclassified|living_street)$"]'
        : '["highway"~"^(primary|secondary|tertiary|trunk)$"]';

      // Use fuzzy matching with regex contains instead of exact match
      query = `
        [out:json][timeout:25];
        (
          way${highwayFilter}["name"~"${queryRegex}",i](${bbox});
          way${highwayFilter}["name:bg"~"${queryRegex}",i](${bbox});
        );
        out geom;
      `;
    }

    // Try each Overpass instance; retry within the same instance for 429 and AbortError (timeout)
    let responseData: OverpassResponse | null = null;
    let lastError: Error | null = null;

    outerLoop: for (const instance of OVERPASS_INSTANCES) {
      for (let attempt = 1; attempt <= OVERPASS_RETRY_MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          OVERPASS_TIMEOUT_MS,
        );

        try {
          const response = await fetch(instance, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
              "User-Agent": `oboapp/1.0 (${APP_URL})`,
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            const text = await response.text();
            const errorMsg = parseOverpassError(text) || response.statusText;
            const err: ErrorWithStatusCode = new Error(
              `HTTP ${response.status}: ${errorMsg}`,
            );
            err.statusCode = response.status;

            if (!shouldTryFallback(err, response.status)) {
              logger.debug("Client error (query issue)", { errorMsg });
              throw err;
            }

            // 429: retry this instance with backoff
            if (
              response.status === 429 &&
              attempt < OVERPASS_RETRY_MAX_ATTEMPTS
            ) {
              const retryAfterMs = parseRetryAfterMs(
                response.headers.get("Retry-After"),
              );
              const waitMs = calculateRetryDelayMs(attempt, retryAfterMs);
              logger.info(
                "Rate limited by Overpass instance, retrying with backoff",
                {
                  hostname: new URL(instance).hostname,
                  attempt,
                  waitMs,
                },
              );
              await delay(waitMs);
              continue; // retry this instance
            }

            logger.info("Server error from Overpass instance", {
              hostname: new URL(instance).hostname,
              errorMsg,
            });
            lastError = err;
            continue outerLoop; // try next instance
          }

          // Parse JSON defensively - buffer as text first
          const text = await response.text();
          try {
            responseData = JSON.parse(text);
          } catch {
            // Failed to parse JSON — might be an upstream HTML/XML error page with HTTP 200.
            // Re-throw with a transient/server-oriented message so fallback/deferred retry
            // can apply. parseOverpassError handles real Overpass XML errors (e.g. query
            // syntax errors) which remain non-retryable via shouldTryFallback.
            const errorMsg = parseOverpassError(text);
            if (errorMsg) throw new Error(errorMsg);
            throw new Error(
              "Overpass instance returned a non-JSON success response; treating as transient upstream failure",
            );
          }

          logger.info("Response from Overpass instance", {
            hostname: new URL(instance).hostname,
          });
          break outerLoop; // success
        } catch (error) {
          clearTimeout(timeoutId);

          const err: ErrorWithStatusCode =
            error instanceof Error ? error : new Error(String(error));

          if (!shouldTryFallback(err, err.statusCode)) {
            logger.debug("Client error (query issue)", { error: err.message });
            throw err;
          }

          // AbortError (timeout): retry this instance with backoff
          const isAbort = err.name === "AbortError";
          if (isAbort && attempt < OVERPASS_RETRY_MAX_ATTEMPTS) {
            const waitMs = calculateRetryDelayMs(attempt, null);
            logger.info(
              "Timeout from Overpass instance, retrying with backoff",
              {
                hostname: new URL(instance).hostname,
                attempt,
                waitMs,
              },
            );
            await delay(waitMs);
            continue; // retry this instance
          }

          logger.info(
            isAbort
              ? "Timeout with Overpass instance"
              : "Failed with Overpass instance",
            {
              hostname: new URL(instance).hostname,
              ...(isAbort ? {} : { error: err.message }),
            },
          );
          lastError = err;
          continue outerLoop; // try next instance
        }
      }
    }

    if (!responseData) {
      throw lastError || new Error("All Overpass instances failed");
    }

    // API responded — count as success to reset the circuit breaker
    if (runCtx) recordSuccess(runCtx);

    if (!responseData.elements || responseData.elements.length === 0) {
      // No OSM ways found - API request succeeded but no data for this street name
      logger.info("Could not find street in OSM", { streetName });
      streetGeometryCache.set(cacheKey, null);
      deferredKeys?.delete(cacheKey);
      return null;
    }

    // Build MultiLineString with each OSM way as a separate LineString
    // For squares (nodes), create a small point geometry
    const lineStrings: Position[][] = [];
    let totalPoints = 0;

    for (const element of responseData.elements) {
      if (
        element.type === "node" &&
        element.lat !== undefined &&
        element.lon !== undefined
      ) {
        // Square represented as a point - create a small box around it
        const lat = element.lat;
        const lon = element.lon;
        const offset = 0.0001; // ~10 meters
        lineStrings.push([
          [lon - offset, lat - offset],
          [lon + offset, lat + offset],
        ]);
        totalPoints += 2;
      } else if (
        element.type === "way" &&
        element.geometry &&
        element.geometry.length >= 2
      ) {
        // Round coordinates to 6 decimal places (≈ 0.1m accuracy)
        const coordinates: Position[] = element.geometry.map(
          (point: OverpassGeometry) => [
            roundCoordinate(point.lon),
            roundCoordinate(point.lat),
          ],
        );
        lineStrings.push(coordinates);
        totalPoints += coordinates.length;
      }
    }

    if (lineStrings.length === 0) {
      logger.info("No valid geometries in response", { streetName });
      streetGeometryCache.set(cacheKey, null);
      deferredKeys?.delete(cacheKey);
      return null;
    }

    logger.info("Found way segments", {
      segments: lineStrings.length,
      totalPoints,
      streetName,
    });

    const multiLineString: Feature<MultiLineString> = {
      type: "Feature",
      properties: { name: streetName },
      geometry: {
        type: "MultiLineString",
        coordinates: lineStrings,
      },
    };

    streetGeometryCache.set(cacheKey, multiLineString);
    deferredKeys?.delete(cacheKey);
    return multiLineString;
  } catch (error) {
    const err: ErrorWithStatusCode =
      error instanceof Error ? error : new Error(String(error));
    const retryable = shouldTryFallback(err, err.statusCode);
    const log = retryable ? logger.warn : logger.error;
    log("Error fetching from Overpass", {
      streetName,
      error: err.message,
    });

    if (retryable) {
      if (deferredKeys) {
        deferredKeys.add(cacheKey);
      }
      if (runCtx) recordTransientFailure(runCtx);
      logger.info("Deferring street geometry after transient failure", {
        streetName,
      });
      return null;
    }
    logger.error("Non-retryable Overpass error while resolving street", {
      streetName,
      error: err.message,
    });
    return null;
  }
}

/**
 * Find geometric intersection between two street geometries
 */
function findGeometricIntersection(
  street1: Feature<MultiLineString>,
  street2: Feature<MultiLineString>,
): Coordinates | null {
  try {
    // First, try exact intersection using turf.lineIntersect
    const intersections = turf.lineIntersect(street1, street2);

    if (intersections.features.length > 0) {
      logger.info("Found exact intersections", {
        count: intersections.features.length,
      });

      if (intersections.features.length === 1) {
        const point = intersections.features[0].geometry.coordinates;
        logger.info("Intersection found", {
          lat: point[1].toFixed(6),
          lng: point[0].toFixed(6),
        });
        return { lng: point[0], lat: point[1] };
      }

      // Multiple intersections - use locality center as reference point
      const localityCenter = getLocalityCenter();
      const targetPoint = turf.point([localityCenter.lng, localityCenter.lat]);

      const intersectionsWithDistance = intersections.features.map(
        (feature) => {
          const coords = feature.geometry.coordinates;
          const distance = turf.distance(targetPoint, feature, {
            units: "meters",
          });
          return {
            lat: coords[1],
            lng: coords[0],
            distance: distance,
          };
        },
      );

      // Sort by distance from Sofia center
      intersectionsWithDistance.sort((a, b) => a.distance - b.distance);

      const best = intersectionsWithDistance[0];
      logger.info("Using closest intersection to Sofia center", {
        lat: best.lat.toFixed(6),
        lng: best.lng.toFixed(6),
        distanceMeters: best.distance.toFixed(0),
      });

      return { lng: best.lng, lat: best.lat };
    }

    // If no exact intersection, find nearest points
    logger.info("No exact intersections, finding nearest points");

    // Buffer the streets slightly to account for small gaps
    const buffered1 = turf.buffer(street1, BUFFER_DISTANCE_METERS, {
      units: "meters",
    });
    const buffered2 = turf.buffer(street2, BUFFER_DISTANCE_METERS, {
      units: "meters",
    });

    if (!buffered1 || !buffered2) {
      logger.warn("Could not create buffers");
      return null;
    }

    // Try intersection on buffered geometries
    const bufferedIntersection = turf.intersect(
      turf.featureCollection([buffered1, buffered2]),
    );

    if (bufferedIntersection) {
      const center = turf.center(bufferedIntersection);
      const coords = center.geometry.coordinates;
      logger.info("Found buffered intersection");
      return { lng: coords[0], lat: coords[1] };
    }

    // Last resort: find nearest point between the two lines
    let minDistance = Number.POSITIVE_INFINITY;
    let bestPoint: Coordinates | null = null;

    for (const line1 of street1.geometry.coordinates) {
      for (const line2 of street2.geometry.coordinates) {
        const _lineString1 = turf.lineString(line1);
        const lineString2 = turf.lineString(line2);

        // Sample points along both lines
        for (const point1 of line1) {
          const pt1 = turf.point(point1);
          const nearest = turf.nearestPointOnLine(lineString2, pt1);
          const dist = turf.distance(pt1, nearest, { units: "meters" });

          if (dist < minDistance) {
            minDistance = dist;
            const coords = nearest.geometry.coordinates;
            bestPoint = { lng: coords[0], lat: coords[1] };
          }
        }
      }
    }

    if (bestPoint && minDistance < 200) {
      // 200m threshold
      logger.info("Found nearest point", {
        lat: bestPoint.lat.toFixed(6),
        lng: bestPoint.lng.toFixed(6),
        gapMeters: minDistance.toFixed(1),
      });
      return bestPoint;
    }

    logger.warn("Streets too far apart, no valid intersection", {
      distanceMeters: minDistance.toFixed(1),
    });
    return null;
  } catch (error) {
    logger.error("Error finding intersection", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function geocodeSingleIntersection(
  intersection: string,
): Promise<Address | null> {
  const [street1Name, street2Name] = parseIntersectionStreetNames(intersection);

  if (!street1Name || !street2Name) {
    logger.error("Invalid intersection format", { intersection });
    return null;
  }

  const geom1 = await getStreetGeometryFromOverpass(street1Name);
  const geom2 = await getStreetGeometryFromOverpass(street2Name);

  if (!geom1 || !geom2) {
    return null;
  }

  const intersectionPoint = findGeometricIntersection(geom1, geom2);

  if (!intersectionPoint) {
    logger.error("Could not find intersection");
    return null;
  }

  const qualitySignals = gradeOverpass("node"); // Intersection resolves to a node point

  return {
    originalText: intersection,
    formattedAddress: intersection,
    coordinates: { lat: intersectionPoint.lat, lng: intersectionPoint.lng },
    geoJson: {
      type: "Point",
      coordinates: [intersectionPoint.lng, intersectionPoint.lat],
    },
    qualitySignals,
  };
}

/**
 * Main geocoding function using Overpass API and Turf.js
 */
export async function overpassGeocodeIntersections(
  intersections: string[],
): Promise<Address[]> {
  // Use mock if enabled
  if (USE_MOCK && mockService) {
    logger.info("Using Overpass mock for intersections");
    return mockService.overpassGeocodeIntersections(intersections);
  }

  return runWithDeferredRetryScope(async () => {
    const results: Address[] = [];
    const retryIntersections: string[] = [];

    async function processIntersections(
      queue: string[],
      collectRetryCandidates: boolean,
    ): Promise<void> {
      for (let i = 0; i < queue.length; i++) {
        const intersection = queue[i];
        try {
          const result = await geocodeSingleIntersection(intersection);
          if (result) {
            results.push(result);
          } else if (
            collectRetryCandidates &&
            shouldRetryIntersectionLater(intersection)
          ) {
            retryIntersections.push(intersection);
          }
        } catch (error) {
          logger.error("Error processing intersection", {
            intersection,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (i < queue.length - 1) {
          await delay(OVERPASS_DELAY_MS);
        }
      }
    }

    await processIntersections(intersections, true);

    if (retryIntersections.length > 0) {
      logger.info("Retrying deferred intersections", {
        count: retryIntersections.length,
      });
      clearDeferredStreetGeometryKeys();
      await processIntersections(retryIntersections, false);
    }

    return results;
  });
}

/**
 * Get street section geometry between two intersection points
 * Returns the actual OSM geometry of the street segment
 */
export async function getStreetSectionGeometry(
  streetName: string,
  startCoords: Coordinates,
  endCoords: Coordinates,
): Promise<Position[] | null> {
  // Use mock if enabled
  if (USE_MOCK && mockService) {
    logger.info("Using Overpass mock for street section geometry");
    return mockService.getStreetSectionGeometry(
      streetName,
      startCoords,
      endCoords,
    );
  }

  return runWithDeferredRetryScope(async () => {
    try {
      logger.info("Finding street section", {
        streetName,
        from: { lat: startCoords.lat, lng: startCoords.lng },
        to: { lat: endCoords.lat, lng: endCoords.lng },
      });

      // Get full street geometry
      const streetGeometry = await getStreetGeometryFromOverpass(streetName);
      if (!streetGeometry) {
        logger.warn("No geometry found for street", { streetName });
        return null;
      }

      // Create points from coordinates
      const startPoint = turf.point([startCoords.lng, startCoords.lat]);
      const endPoint = turf.point([endCoords.lng, endCoords.lat]);

      // Find which segments contain or are near our start/end points
      const allSegments = streetGeometry.geometry.coordinates;
      let bestSection: Position[] | null = null;
      let minTotalDistance = Infinity;

      // Try each segment as a potential section
      for (const segment of allSegments) {
        if (segment.length < 2) continue;

        const line = turf.lineString(segment);

        // Check if both points are close to this segment
        const startSnapped = turf.nearestPointOnLine(line, startPoint);
        const endSnapped = turf.nearestPointOnLine(line, endPoint);

        const startDist = turf.distance(startPoint, startSnapped, {
          units: "meters",
        });
        const endDist = turf.distance(endPoint, endSnapped, {
          units: "meters",
        });

        // If both points are within 50m of this segment, it might be our section
        if (startDist < 50 && endDist < 50) {
          const totalDist = startDist + endDist;

          if (totalDist < minTotalDistance) {
            minTotalDistance = totalDist;

            // Extract the subsection between the two snapped points
            const startIndex = startSnapped.properties.index || 0;
            const endIndex = endSnapped.properties.index || segment.length - 1;

            const minIndex = Math.min(startIndex, endIndex);
            const maxIndex = Math.max(startIndex, endIndex);

            // Extract coordinates between the indices
            let section = segment.slice(minIndex, maxIndex + 2);

            // CRITICAL: Preserve directionality from start→end
            // If startIndex > endIndex, we need to reverse the section
            // to maintain the semantic order (from start coords to end coords)
            if (startIndex > endIndex) {
              section = section.slice().reverse();
            }

            bestSection = section;
          }
        }
      }

      if (bestSection && bestSection.length >= 2) {
        logger.info("Found street section", { points: bestSection.length });
        return bestSection;
      }

      // Fallback: try to connect multiple segments
      logger.info("No single segment found, trying to connect segments");

      // Build a path by connecting segments
      const connectedPath: Position[] = [];
      let currentPoint = startPoint;
      const usedSegments = new Set<number>();

      while (
        connectedPath.length === 0 ||
        turf.distance(
          turf.point(connectedPath[connectedPath.length - 1]),
          endPoint,
          { units: "meters" },
        ) > 10
      ) {
        // Find nearest unused segment to current point
        let nearestSegmentIdx = -1;
        let nearestDist = Infinity;

        for (let i = 0; i < allSegments.length; i++) {
          if (usedSegments.has(i)) continue;

          const segment = allSegments[i];
          if (segment.length < 2) continue;

          const line = turf.lineString(segment);
          const snapped = turf.nearestPointOnLine(line, currentPoint);
          const dist = turf.distance(currentPoint, snapped, {
            units: "meters",
          });

          if (dist < nearestDist) {
            nearestDist = dist;
            nearestSegmentIdx = i;
          }
        }

        if (nearestSegmentIdx === -1 || nearestDist > 50) {
          logger.info("Cannot connect segments", {
            minDistanceMeters: nearestDist,
          });
          break;
        }

        // Add this segment
        usedSegments.add(nearestSegmentIdx);
        const segment = allSegments[nearestSegmentIdx];

        // Determine direction and add coordinates
        if (connectedPath.length === 0) {
          connectedPath.push(...segment);
        } else {
          // Check if we need to reverse
          const lastPoint = turf.point(connectedPath[connectedPath.length - 1]);
          const segmentStart = turf.point(segment[0]);
          const segmentEnd = turf.point(segment[segment.length - 1]);

          const distToStart = turf.distance(lastPoint, segmentStart, {
            units: "meters",
          });
          const distToEnd = turf.distance(lastPoint, segmentEnd, {
            units: "meters",
          });

          if (distToEnd < distToStart) {
            // Reverse and add
            connectedPath.push(...segment.slice().reverse());
          } else {
            connectedPath.push(...segment);
          }
        }

        currentPoint = turf.point(connectedPath[connectedPath.length - 1]);

        // Safety check
        if (usedSegments.size > 10) {
          logger.info("Too many segments, giving up");
          break;
        }
      }

      if (connectedPath.length >= 2) {
        logger.info("Connected segments into path", {
          segments: usedSegments.size,
          points: connectedPath.length,
        });
        return connectedPath;
      }

      logger.info("Could not extract street section");
      return null;
    } catch (error) {
      logger.error("Error getting street section geometry", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });
}

/**
 * Normalize an address for Nominatim queries
 * - Strips "№" symbol (Nominatim doesn't understand it)
 * - Normalizes whitespace
 */
export function normalizeAddressForNominatim(address: string): string {
  return address.replaceAll(/№\s*/g, "").replaceAll(/\s+/g, " ").trim();
}

/**
 * Geocode a specific address with house number using Nominatim
 */
async function geocodeAddressWithNominatim(
  address: string,
): Promise<Coordinates | null> {
  try {
    const normalizedAddress = normalizeAddressForNominatim(address);

    // Use normalized address with bounded search
    // The bounds parameter limits results to the configured locality
    const fullAddress = normalizedAddress;

    // Add bounded search to locality area and increase limit to filter results
    const bounds = getLocalityBounds();
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      fullAddress,
    )}&format=json&limit=5&addressdetails=1&bounded=1&viewbox=${
      bounds.west
    },${bounds.south},${bounds.east},${bounds.north}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "OborishteMap/1.0",
      },
    });

    if (!response.ok) {
      logger.warn("Nominatim API error", { status: response.status });
      return null;
    }

    const data = await response.json();

    if (data && data.length > 0) {
      // Find first result that is actually within Sofia boundaries
      for (const result of data) {
        const coords = {
          lat: Number.parseFloat(result.lat),
          lng: Number.parseFloat(result.lon),
        };

        // Validate coordinates are within locality
        const locality = getLocality();
        if (isWithinBounds(locality, coords.lat, coords.lng)) {
          logger.info("Nominatim geocoded address", {
            address,
            lat: coords.lat,
            lng: coords.lng,
          });
          return coords;
        }
        logger.warn("Nominatim result outside target locality", {
          address,
          locality,
          lat: coords.lat,
          lng: coords.lng,
        });
      }

      logger.warn("All Nominatim results outside Sofia", { address });
      return null;
    }

    logger.warn("Nominatim found no results", { address });
    return null;
  } catch (error) {
    logger.error("Error geocoding with Nominatim", {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveSingleAddress(
  address: string,
): Promise<Coordinates | null> {
  // Pattern: "ул. Name Number" or "бул. Name Number"
  const hasNumber = /\d+/.test(address);

  if (hasNumber) {
    logger.info("Geocoding numbered address with Nominatim", { address });
    return geocodeAddressWithNominatim(address);
  }

  // Use Overpass for street names (get center of street)
  const geom = await getStreetGeometryFromOverpass(address);
  if (!geom) return null;

  const centerCoords = turf.center(geom).geometry.coordinates;
  return { lat: centerCoords[1], lng: centerCoords[0] };
}

/**
 * Geocode individual addresses using Overpass API
 */
export async function overpassGeocodeAddresses(
  addresses: string[],
): Promise<Address[]> {
  // Use mock if enabled
  if (USE_MOCK && mockService) {
    logger.info("Using Overpass mock for addresses");
    return mockService.overpassGeocodeAddresses(addresses);
  }

  return runWithDeferredRetryScope(async () => {
    const results: Address[] = [];

    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];

      try {
        const coords = await resolveSingleAddress(address);
        if (coords) {
          const qualitySignals = gradeOverpass("node"); // Overpass address: conservative tier
          results.push({
            originalText: address,
            formattedAddress: address,
            coordinates: coords,
            geoJson: {
              type: "Point",
              coordinates: [coords.lng, coords.lat],
            },
            qualitySignals,
          });
        } else {
          logger.warn("Failed to geocode address", { address });
        }
      } catch (error) {
        logger.error("Error geocoding address", {
          address,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Rate limiting
      if (i < addresses.length - 1) {
        await delay(OVERPASS_DELAY_MS);
      }
    }

    return results;
  });
}
