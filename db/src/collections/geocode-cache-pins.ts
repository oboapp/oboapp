/**
 * Geocode cache for pins (Google Geocoding API results).
 *
 * Stores pre-cached address → coordinates mappings to avoid
 * redundant Google Geocoding API calls for frequently repeated addresses.
 */

import type { DbClient, WhereClause } from "../types";

export const GEOCODE_CACHE_PINS_COLLECTION = "geocodeCachePins";

export class GeocodeCachePinsRepository {
  constructor(private readonly db: DbClient) {}

  async findByKey(key: string): Promise<Record<string, unknown> | null> {
    const results = await this.db.findMany(GEOCODE_CACHE_PINS_COLLECTION, {
      where: [{ field: "key", op: "==", value: key }],
      limit: 1,
    });
    return results[0] ?? null;
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    return this.db.findMany(GEOCODE_CACHE_PINS_COLLECTION);
  }

  async insertOne(data: Record<string, unknown>): Promise<string> {
    return this.db.insertOne(GEOCODE_CACHE_PINS_COLLECTION, data);
  }

  async deleteOne(id: string): Promise<void> {
    return this.db.deleteOne(GEOCODE_CACHE_PINS_COLLECTION, id);
  }

  async count(where?: WhereClause[]): Promise<number> {
    return this.db.count(GEOCODE_CACHE_PINS_COLLECTION, where);
  }
}
