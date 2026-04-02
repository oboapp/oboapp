/**
 * Geocode cache for streets (Overpass API results).
 *
 * Stores pre-cached street name → full geometry mappings. The cache key
 * is the normalized street name alone (e.g. "витоша"). The stored geometry
 * is the complete LineString or MultiLineString for that street, so any
 * intersection involving the street can be computed locally without an
 * additional Overpass API call.
 *
 * Document shape:
 *   key            — normalized street name (cache lookup key, unique)
 *   originalText   — original street name before normalization
 *   geoJson        — full street geometry (LineString or MultiLineString)
 *   sourceService  — always "overpass"
 *   sourceMessageId — message ID used as the source for this entry
 *   cachedAt       — timestamp of insertion
 */

import type { DbClient, WhereClause } from "../types";

export const GEOCODE_CACHE_STREETS_COLLECTION = "geocodeCacheStreets";

export class GeocodeCacheStreetsRepository {
  constructor(private readonly db: DbClient) {}

  async findByKey(key: string): Promise<Record<string, unknown> | null> {
    const results = await this.db.findMany(GEOCODE_CACHE_STREETS_COLLECTION, {
      where: [{ field: "key", op: "==", value: key }],
      limit: 1,
    });
    return results[0] ?? null;
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    return this.db.findMany(GEOCODE_CACHE_STREETS_COLLECTION);
  }

  async insertOne(data: Record<string, unknown>): Promise<string> {
    return this.db.insertOne(GEOCODE_CACHE_STREETS_COLLECTION, data);
  }

  async deleteOne(id: string): Promise<void> {
    return this.db.deleteOne(GEOCODE_CACHE_STREETS_COLLECTION, id);
  }

  async count(where?: WhereClause[]): Promise<number> {
    return this.db.count(GEOCODE_CACHE_STREETS_COLLECTION, where);
  }
}
