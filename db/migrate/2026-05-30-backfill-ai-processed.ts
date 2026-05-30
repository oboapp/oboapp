#!/usr/bin/env -S npx tsx

/**
 * Migration: Backfill required aiProcessed field on messages.
 *
 * Purpose:
 * - Ensure all existing message documents have aiProcessed set as a boolean.
 * - Preserve current behavior using the existing sentinel logic:
 *   - aiProcessed = true  when plainText is a non-empty string
 *   - aiProcessed = false otherwise
 *
 * Idempotent:
 * - Documents that already have aiProcessed as boolean are skipped.
 * - Safe to re-run at any time.
 *
 * Usage:
 *   cd db && npx tsx migrate/2026-05-30-backfill-ai-processed.ts
 */

import dotenv from "dotenv";
import { resolve } from "node:path";

// Load env from ingest/.env.local
dotenv.config({ path: resolve(process.cwd(), "../ingest/.env.local") });

const PAGE_SIZE = 200;
const MAX_BATCH_OPS = 450;

function deriveAiProcessed(data: FirebaseFirestore.DocumentData): boolean {
  return typeof data.plainText === "string" && data.plainText.trim().length > 0;
}

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

  if (!getApps().length) {
    const serviceAccount = JSON.parse(getServiceAccountKey());
    const app = initializeApp({ credential: cert(serviceAccount) });
    return getFirestore(app);
  }

  return getFirestore(getApps()[0]);
}

function createBaseQuery(adminDb: FirebaseFirestore.Firestore) {
  return adminDb.collection("messages").orderBy("__name__").limit(PAGE_SIZE);
}

function logProgress(stats: MigrationStats) {
  console.log(
    `  Processed ${stats.totalProcessed} docs (updated: ${stats.updated}, skipped: ${stats.skippedAlreadySet})...`,
  );
}

function logSummary(stats: MigrationStats) {
  console.log("\n✓ Migration completed successfully!");
  console.log(`  Total processed: ${stats.totalProcessed}`);
  console.log(`  Updated: ${stats.updated}`);
  console.log(`  Skipped (already boolean): ${stats.skippedAlreadySet}`);
  console.log(`  Set aiProcessed=true: ${stats.setTrue}`);
  console.log(`  Set aiProcessed=false: ${stats.setFalse}`);
}

async function processSnapshot(
  adminDb: FirebaseFirestore.Firestore,
  snapshot: FirebaseFirestore.QuerySnapshot,
  stats: MigrationStats,
): Promise<FirebaseFirestore.QueryDocumentSnapshot> {
  let batch = adminDb.batch();
  let batchOps = 0;
  let lastDoc = snapshot.docs[snapshot.docs.length - 1]!;

  for (const doc of snapshot.docs) {
    stats.totalProcessed++;
    lastDoc = doc;

    const data = doc.data();
    if (typeof data.aiProcessed === "boolean") {
      stats.skippedAlreadySet++;
      continue;
    }

    const aiProcessed = deriveAiProcessed(data);
    if (aiProcessed) {
      stats.setTrue++;
    } else {
      stats.setFalse++;
    }

    batch.update(doc.ref, { aiProcessed });
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

  console.log("Starting migration: backfill aiProcessed on messages...");

  const stats: MigrationStats = {
    totalProcessed: 0,
    updated: 0,
    skippedAlreadySet: 0,
    setTrue: 0,
    setFalse: 0,
  };

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = createBaseQuery(adminDb);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    lastDoc = await processSnapshot(adminDb, snapshot, stats);
    logProgress(stats);

    if (snapshot.size < PAGE_SIZE) break;
  }

  logSummary(stats);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
