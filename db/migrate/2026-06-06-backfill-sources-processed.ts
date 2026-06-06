#!/usr/bin/env -S npx tsx

/**
 * Migration: Backfill the `processed` flag on source documents.
 *
 * Purpose:
 * - The ingest pipeline now fetches only unprocessed sources
 *   (`where processed == false`) instead of re-scanning the entire `sources`
 *   collection on every run. This requires every existing source document to
 *   carry an explicit boolean `processed` flag.
 * - A source is considered processed when a corresponding `messages` document
 *   exists (linked by `sourceDocumentId`, which equals the source document ID).
 *   This mirrors the previous message-existence deduplication exactly.
 *
 * Behavior:
 * - processed = true  when at least one message references the source.
 * - processed = false otherwise.
 *
 * Idempotent:
 * - Source documents that already have `processed` as a boolean are skipped.
 * - Safe to re-run at any time.
 *
 * Note:
 * - This migration uses the Firebase Admin SDK and writes directly to
 *   Firestore. If your deployment also runs MongoDB (dual-write mode), run a
 *   equivalent migration against your MongoDB instance separately.
 *
 * Usage:
 *   cd db && npx tsx migrate/2026-06-06-backfill-sources-processed.ts
 */

import dotenv from "dotenv";
import { resolve } from "node:path";

// Load env from ingest/.env.local
dotenv.config({ path: resolve(process.cwd(), "../ingest/.env.local") });

const PAGE_SIZE = 200;
const MAX_BATCH_OPS = 450;

type MigrationStats = {
  totalProcessed: number;
  updated: number;
  skippedAlreadySet: number;
  setTrue: number;
  setFalse: number;
};

function getServiceAccountKey(): string {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!key) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is required to run this migration",
    );
  }

  return key;
}

async function getAdminDb(): Promise<FirebaseFirestore.Firestore> {
  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  const databaseId = process.env.FIREBASE_DATABASE_ID;

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert(JSON.parse(getServiceAccountKey())) });

  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

/**
 * Build the set of source document IDs that already have at least one message.
 * Pages through the entire messages collection once, selecting only the
 * sourceDocumentId field to minimize read cost.
 */
async function loadProcessedSourceIds(
  adminDb: FirebaseFirestore.Firestore,
): Promise<Set<string>> {
  const processedIds = new Set<string>();
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let scanned = 0;

  while (true) {
    let query = adminDb
      .collection("messages")
      .select("sourceDocumentId")
      .orderBy("__name__")
      .limit(PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      scanned++;
      const sourceDocumentId = doc.get("sourceDocumentId");
      if (typeof sourceDocumentId === "string" && sourceDocumentId.length > 0) {
        processedIds.add(sourceDocumentId);
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  console.log(
    `  Scanned ${scanned} messages; found ${processedIds.size} distinct processed sources.`,
  );
  return processedIds;
}

function logProgress(stats: MigrationStats) {
  console.log(
    `  Processed ${stats.totalProcessed} sources (updated: ${stats.updated}, skipped: ${stats.skippedAlreadySet})...`,
  );
}

function logSummary(stats: MigrationStats) {
  console.log("\n✓ Migration completed successfully!");
  console.log(`  Total processed: ${stats.totalProcessed}`);
  console.log(`  Updated: ${stats.updated}`);
  console.log(`  Skipped (already boolean): ${stats.skippedAlreadySet}`);
  console.log(`  Set processed=true: ${stats.setTrue}`);
  console.log(`  Set processed=false: ${stats.setFalse}`);
}

async function processSnapshot(
  adminDb: FirebaseFirestore.Firestore,
  snapshot: FirebaseFirestore.QuerySnapshot,
  processedIds: Set<string>,
  stats: MigrationStats,
): Promise<FirebaseFirestore.QueryDocumentSnapshot> {
  let batch = adminDb.batch();
  let batchOps = 0;
  let lastDoc = snapshot.docs[snapshot.docs.length - 1]!;

  for (const doc of snapshot.docs) {
    stats.totalProcessed++;
    lastDoc = doc;

    const data = doc.data();
    if (typeof data.processed === "boolean") {
      stats.skippedAlreadySet++;
      continue;
    }

    // The source document ID equals the message sourceDocumentId.
    const processed = processedIds.has(doc.id);
    if (processed) {
      stats.setTrue++;
    } else {
      stats.setFalse++;
    }

    batch.update(doc.ref, { processed });
    stats.updated++;
    batchOps++;

    if (batchOps >= MAX_BATCH_OPS) {
      await batch.commit();
      batch = adminDb.batch();
      batchOps = 0;
    }
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  return lastDoc;
}

async function main() {
  const adminDb = await getAdminDb();

  console.log("Starting migration: backfill processed flag on sources...");

  const processedIds = await loadProcessedSourceIds(adminDb);

  const stats: MigrationStats = {
    totalProcessed: 0,
    updated: 0,
    skippedAlreadySet: 0,
    setTrue: 0,
    setFalse: 0,
  };

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = adminDb
      .collection("sources")
      .orderBy("__name__")
      .limit(PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    lastDoc = await processSnapshot(adminDb, snapshot, processedIds, stats);
    logProgress(stats);

    if (snapshot.size < PAGE_SIZE) break;
  }

  logSummary(stats);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
