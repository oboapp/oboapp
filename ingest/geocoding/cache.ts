/**
 * In-memory geocoding cache backed by the geocode cache DB collections.
 *
 * Lazy-loaded singletons — the DB is only queried once per process.
 * Call clearGeocodingCache() in tests for isolation.
 */

import type { Feature, MultiLineString } from "geojson";
import type { Address } from "@/lib/types";
import { getString, getCoordinates, isRecord } from "@/lib/record-fields";
import { normalizePinAddress } from "@oboapp/shared";
import { logger } from "@/lib/logger";

// Pin cache: normalized address string → Address
let pinCache: Map<string, Address> | null = null;

// Street cache seeding flag (streetGeometryCache lives in overpass/service.ts)
let streetCacheSeeded = false;

function isFeatureMultiLineString(v: unknown): v is Feature<MultiLineString> {
  return (
    isRecord(v) &&
    v.type === "Feature" &&
    isRecord(v.geometry) &&
    v.geometry.type === "MultiLineString"
  );
}

function recordToAddress(e: Record<string, unknown>): [string, Address] | null {
  const key = getString(e.key);
  if (!key) {
    logger.warn("Geocode cache pin entry missing key, skipping", { entry: e });
    return null;
  }
  const coordinates = getCoordinates(e.coordinates);
  if (!coordinates) {
    logger.warn("Geocode cache pin entry missing coordinates, skipping", { key });
    return null;
  }
  const rawGeoJson = e.geoJson;
  let geoJson: Address["geoJson"];
  if (isRecord(rawGeoJson) && rawGeoJson.type === "Point") {
    const coords = rawGeoJson.coordinates;
    if (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      geoJson = {
        type: "Point",
        coordinates: [coords[0], coords[1]],
      } satisfies Address["geoJson"] & object;
    }
  }
  return [
    key,
    {
      originalText: getString(e.originalText),
      formattedAddress: getString(e.formattedAddress),
      coordinates,
      geoJson,
    },
  ];
}

/**
 * Look up a pre-cached pin (Google Geocoding result) by normalized address key.
 * Lazy-loads all DB pin cache entries on first call.
 */
export async function lookupCachedPin(
  normalizedAddress: string,
): Promise<Address | null> {
  if (!pinCache) {
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const entries = await db.geocodeCachePins.findAll();
    pinCache = new Map(
      entries.flatMap((e) => {
        const pair = recordToAddress(e);
        return pair ? [pair] : [];
      }),
    );
  }
  return pinCache.get(normalizedAddress) ?? null;
}

/**
 * Pre-populate the Overpass street geometry cache from the DB collection.
 * No-op after the first call per process.
 */
export async function seedStreetCacheFromDb(): Promise<void> {
  if (streetCacheSeeded) return;
  streetCacheSeeded = true;

  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const entries = await db.geocodeCacheStreets.findAll();
  if (entries.length === 0) return;

  const { seedStreetGeometryCache } = await import("./overpass/service");
  seedStreetGeometryCache(
    entries.flatMap((e) => {
      const originalName = getString(e.originalText);
      const storedKey = getString(e.key);
      const geometry = e.geoJson;
      if (!originalName || !isFeatureMultiLineString(geometry)) return [];
      // Validate data integrity: re-normalizing originalText must reproduce the
      // stored key. A mismatch means the DB entry was written inconsistently,
      // and seeding it would populate the wrong in-memory cache key.
      if (storedKey && normalizePinAddress(originalName) !== storedKey) {
        logger.warn(
          "Geocode cache street entry key mismatch — skipping inconsistent DB entry",
          { originalText: originalName, storedKey, recomputedKey: normalizePinAddress(originalName) },
        );
        return [];
      }
      return [{ originalName, geometry }];
    }),
  );
}

/** Reset all caches. For test isolation only. */
export function clearGeocodingCache(): void {
  pinCache = null;
  streetCacheSeeded = false;
}
