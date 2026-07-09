/**
 * Geocode cache for street name synonyms.
 *
 * Maps alternative street name spellings (synonyms) to their canonical name
 * in the geocodeCacheStreets collection. When the pipeline encounters a synonym
 * during geocoding, it uses the canonical street's geometry instead of making
 * a new Overpass API call.
 *
 * Document shape:
 *   synonymKey     — normalized synonym name (cache lookup key, unique)
 *   synonymText    — original synonym text before normalization
 *   canonicalKey   — normalized canonical street name (must exist in geocodeCacheStreets)
 *   canonicalText  — original canonical street text before normalization
 *   createdAt      — timestamp of insertion
 */

import type { DbClient, WhereClause } from "../types";

export const GEOCODE_CACHE_STREET_SYNONYMS_COLLECTION =
  "geocodeCacheStreetSynonyms";

export class GeocodeCacheStreetSynonymsRepository {
  constructor(private readonly db: DbClient) {}

  async findBySynonymKey(
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const results = await this.db.findMany(
      GEOCODE_CACHE_STREET_SYNONYMS_COLLECTION,
      {
        where: [{ field: "synonymKey", op: "==", value: key }],
        limit: 1,
      },
    );
    return results[0] ?? null;
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    return this.db.findMany(GEOCODE_CACHE_STREET_SYNONYMS_COLLECTION);
  }

  async insertOne(data: Record<string, unknown>): Promise<string> {
    return this.db.insertOne(
      GEOCODE_CACHE_STREET_SYNONYMS_COLLECTION,
      data,
    );
  }

  async deleteOne(id: string): Promise<void> {
    return this.db.deleteOne(
      GEOCODE_CACHE_STREET_SYNONYMS_COLLECTION,
      id,
    );
  }

  async count(where?: WhereClause[]): Promise<number> {
    return this.db.count(
      GEOCODE_CACHE_STREET_SYNONYMS_COLLECTION,
      where,
    );
  }
}
