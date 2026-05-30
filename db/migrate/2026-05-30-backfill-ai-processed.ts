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

async function main() {
  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  let adminDb: FirebaseFirestore.Firestore;
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!);
    const app = initializeApp({ credential: cert(serviceAccount) });
    adminDb = getFirestore(app);
  } else {
    adminDb = getFirestore(getApps()[0]);
  }

  console.log("Starting migration: backfill aiProcessed on messages...");

  let totalProcessed = 0;
  let updated = 0;
  let skippedAlreadySet = 0;
  let setTrue = 0;
  let setFalse = 0;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = adminDb
      .collection("messages")
      .orderBy("__name__")
      .limit(PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    let batch = adminDb.batch();
    let batchOps = 0;

    for (const doc of snapshot.docs) {
      lastDoc = doc;
      totalProcessed++;

      const data = doc.data();
      if (typeof data.aiProcessed === "boolean") {
        skippedAlreadySet++;
        continue;
      }

      const aiProcessed = deriveAiProcessed(data);
      if (aiProcessed) {
        setTrue++;
      } else {
        setFalse++;
      }

      batch.update(doc.ref, { aiProcessed });
      updated++;
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

    console.log(
      `  Processed ${totalProcessed} docs (updated: ${updated}, skipped: ${skippedAlreadySet})...`,
    );

    if (snapshot.size < PAGE_SIZE) break;
  }

  console.log("\n✓ Migration completed successfully!");
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (already boolean): ${skippedAlreadySet}`);
  console.log(`  Set aiProcessed=true: ${setTrue}`);
  console.log(`  Set aiProcessed=false: ${setFalse}`);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
