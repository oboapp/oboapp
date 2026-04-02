/**
 * In-memory geocoding cache backed by the geocode cache DB collections.
 *
 * Lazy-loaded singletons — the DB is only queried once per process.
 * Call clearGeocodingCache() in tests for isolation.
 */

import type { Feature, MultiLineString } from "geojson";
import type { Address, Coordinates, GeoJsonPoint } from "@/lib/types";

// Pin cache: normalized address string → Address
let pinCache: Map<string, Address> | null = null;

// Street cache seeding flag (streetGeometryCache lives in overpass/service.ts)
let streetCacheSeeded = false;

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
      entries.map((e) => [
        e.key as string,
        {
          originalText: e.originalText as string,
          formattedAddress: e.formattedAddress as string,
          coordinates: e.coordinates as Coordinates,
          geoJson: e.geoJson as GeoJsonPoint,
        },
      ]),
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
    entries.map((e) => ({
      originalName: e.originalText as string,
      geometry: e.geoJson as Feature<MultiLineString>,
    })),
  );
}

/** Reset all caches. For test isolation only. */
export function clearGeocodingCache(): void {
  pinCache = null;
  streetCacheSeeded = false;
}
