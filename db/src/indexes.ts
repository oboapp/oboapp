/**
 * MongoDB index definitions for all collections.
 *
 * Translated from firestore.indexes.json plus geospatial indexes.
 * Run `ensureIndexes()` after migration or on app startup.
 */

import type { Db, IndexSpecification, CreateIndexesOptions } from "mongodb";

interface IndexDefinition {
  collection: string;
  spec: IndexSpecification;
  options?: CreateIndexesOptions;
}

/**
 * All MongoDB indexes for the oboapp database.
 *
 * These mirror the Firestore composite indexes plus additions
 * that leverage MongoDB-specific features (2dsphere, sparse).
 */
export const INDEX_DEFINITIONS: IndexDefinition[] = [
  // --- messages ---
  {
    collection: "messages",
    spec: { categories: 1, timespanEnd: -1 },
    options: { name: "categories_timespanEnd" },
  },
  {
    collection: "messages",
    spec: { categories: 1, finalizedAt: -1 },
    options: { name: "categories_finalizedAt" },
  },
  {
    collection: "messages",
    spec: { timespanEnd: -1, createdAt: -1 },
    options: { name: "timespanEnd_createdAt" },
  },
  {
    collection: "messages",
    spec: { source: 1, timespanEnd: -1 },
    options: { name: "source_timespanEnd" },
  },
  {
    collection: "messages",
    spec: { notificationsSent: 1, createdAt: 1 },
    options: { name: "notificationsSent_createdAt" },
  },
  {
    collection: "messages",
    spec: { finalizedAt: -1 },
    options: { name: "finalizedAt" },
  },
  {
    collection: "messages",
    spec: { sourceDocumentId: 1 },
    options: { name: "sourceDocumentId" },
  },
  // Indexes for public consumers that filter messages by locality before applying
  // timespan, category, city-wide, and incremental sync constraints.
  {
    collection: "messages",
    spec: { locality: 1, timespanEnd: 1, finalizedAt: -1 },
    options: { name: "locality_timespanEnd_finalizedAt" },
  },
  {
    collection: "messages",
    spec: { locality: 1, categories: 1, timespanEnd: 1, finalizedAt: -1 },
    options: { name: "locality_categories_timespanEnd_finalizedAt" },
  },
  {
    collection: "messages",
    spec: { locality: 1, cityWide: 1, timespanEnd: 1, finalizedAt: -1 },
    options: { name: "locality_cityWide_timespanEnd_finalizedAt" },
  },

  // Required by ysm-api src/endpoints/updatesExport.ts, which filters by
  // locality and sorts incremental exports by finalizedAt first, then
  // crawledAt. No known consumer sorts the same query by crawledAt first.
  // Once YSM has its fork, we can move this index to their codebase
  // and remove it from oboapp/oboapp.
  {
    collection: "messages",
    spec: { locality: 1, finalizedAt: -1, crawledAt: -1 },
    options: { name: "locality_finalizedAt_crawledAt" },
  },
  // 2dsphere index for geospatial queries (replaces app-level geo filtering)
  {
    collection: "messages",
    spec: { "geoJson.features.geometry": "2dsphere" },
    options: { name: "geoJson_2dsphere", sparse: true },
  },

  // --- notificationMatches ---
  {
    collection: "notificationMatches",
    spec: { notified: 1, userId: 1, notifiedAt: -1 },
    options: { name: "notified_userId_notifiedAt" },
  },
  {
    collection: "notificationMatches",
    spec: { userId: 1 },
    options: { name: "userId" },
  },
  {
    collection: "notificationMatches",
    spec: { userId: 1, notified: 1, readAt: 1 },
    options: { name: "userId_notified_readAt" },
  },
  {
    collection: "notificationMatches",
    spec: { "messageSnapshot.source": 1 },
    options: { name: "notificationMatches_messageSnapshot_source" },
  },

  // --- notificationSubscriptions ---
  {
    collection: "notificationSubscriptions",
    spec: { userId: 1 },
    options: { name: "userId" },
  },
  {
    collection: "notificationSubscriptions",
    spec: { userId: 1, token: 1 },
    options: { name: "userId_token", unique: true },
  },

  // --- interests ---
  {
    collection: "interests",
    spec: { userId: 1, createdAt: -1 },
    options: { name: "userId_createdAt" },
  },

  // --- sources ---
  {
    collection: "sources",
    spec: { sourceType: 1 },
    options: { name: "sourceType" },
  },

  // --- apiClients ---
  // apiKey is looked up on every authenticated API request — needs an index
  {
    collection: "apiClients",
    spec: { apiKey: 1 },
    options: { name: "apiKey", unique: true },
  },

  // --- events ---
  {
    collection: "events",
    spec: { cityWide: 1, locality: 1, timespanEnd: 1 },
    options: { name: "cityWide_locality_timespanEnd" },
  },
  {
    collection: "events",
    spec: { locality: 1, timespanEnd: -1 },
    options: { name: "locality_timespanEnd" },
  },
  {
    collection: "events",
    spec: { locality: 1, categories: 1, timespanEnd: -1 },
    options: { name: "locality_categories_timespanEnd" },
  },
  {
    collection: "events",
    spec: { locality: 1, timespanStart: 1, timespanEnd: 1 },
    options: { name: "locality_timeWindow" },
  },

  // --- eventMessages ---
  {
    collection: "eventMessages",
    spec: { eventId: 1, createdAt: -1 },
    options: { name: "eventId_createdAt" },
  },
  {
    collection: "eventMessages",
    spec: { messageId: 1 },
    options: { name: "messageId" },
  },

  // --- geocodeCachePins ---
  {
    collection: "geocodeCachePins",
    spec: { key: 1 },
    options: { name: "key", unique: true },
  },

  // --- geocodeCacheStreets ---
  {
    collection: "geocodeCacheStreets",
    spec: { key: 1 },
    options: { name: "key", unique: true },
  },
];

/**
 * Create all indexes in the database.
 * Safe to call multiple times — MongoDB skips existing indexes.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  console.log("Ensuring MongoDB indexes...\n");

  const failures: string[] = [];

  for (const def of INDEX_DEFINITIONS) {
    try {
      const name = await db
        .collection(def.collection)
        .createIndex(def.spec, def.options);
      console.log(`  ✓ ${def.collection}: ${name}`);
    } catch (err) {
      console.error(
        `  ✗ ${def.collection}: ${def.options?.name ?? "unnamed"}`,
        err instanceof Error ? err.message : err,
      );
      failures.push(`${def.collection}:${def.options?.name ?? "unnamed"}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Failed to create MongoDB indexes: ${failures.join(", ")}`);
  }

  console.log("\nIndex creation complete.");
}

/**
 * List all indexes for verification.
 */
export async function listIndexes(
  db: Db,
): Promise<Map<string, Record<string, unknown>[]>> {
  const result = new Map<string, Record<string, unknown>[]>();

  const collections = new Set(INDEX_DEFINITIONS.map((d) => d.collection));
  for (const col of collections) {
    const indexes = await db.collection(col).listIndexes().toArray();
    result.set(
      col,
      indexes.map((idx) => ({
        name: idx.name,
        key: idx.key,
        unique: idx.unique,
        sparse: idx.sparse,
      })),
    );
  }

  return result;
}
