#!/usr/bin/env npx tsx

/**
 * Migration script to backfill locality field for existing sources and messages
 * Run with:
 *   cd db && npx tsx migrate/2026-02-10-add-locality-field.ts --locality=bg.sofia
 *   cd db && MIGRATION_LOCALITY=bg.sofia npx tsx migrate/2026-02-10-add-locality-field.ts
 * Add --dry-run to preview counts without writing.
 */

import dotenv from "dotenv";
import { resolve } from "node:path";

// Load environment variables from ingest/.env.local
dotenv.config({ path: resolve(process.cwd(), "../ingest/.env.local") });

function parseRequiredLocality(): string {
  const localityArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--locality="));
  const locality = localityArg?.split("=")[1] ?? process.env.MIGRATION_LOCALITY;
  const trimmed = locality?.trim();

  if (!trimmed) {
    throw new Error(
      "Missing locality. Provide --locality=<id> or MIGRATION_LOCALITY.",
    );
  }

  return trimmed;
}

function isDryRun(): boolean {
  return process.argv.slice(2).includes("--dry-run");
}

async function main() {
  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  let adminDb: FirebaseFirestore.Firestore;
  if (!getApps().length) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY!,
    );
    const app = initializeApp({ credential: cert(serviceAccount) });
    adminDb = getFirestore(app);
  } else {
    adminDb = getFirestore(getApps()[0]);
  }

  console.log("Starting migration to add locality field...");
  const locality = parseRequiredLocality();
  const dryRun = isDryRun();

  console.log("Preflight configuration:");
  console.log(`  locality: ${locality}`);
  console.log(`  dry-run: ${dryRun ? "yes" : "no"}`);

  if (dryRun) {
    console.log("  mode: no writes (preview only)");
  }

  // Migrate sources collection
  console.log("\n1. Migrating sources collection...");
  const sourcesSnapshot = await adminDb.collection("sources").get();
  console.log(`Found ${sourcesSnapshot.size} sources`);

  let sourcesUpdated = 0;
  let sourcesSkipped = 0;

  for (const doc of sourcesSnapshot.docs) {
    const data = doc.data();

    // Skip if locality already exists
    if (data.locality) {
      sourcesSkipped++;
      continue;
    }

    if (!dryRun) {
      await doc.ref.update({ locality });
    }
    sourcesUpdated++;

    if (sourcesUpdated % 100 === 0) {
      console.log(`  Updated ${sourcesUpdated} sources...`);
    }
  }

  console.log(
    `✓ Sources migration complete: ${sourcesUpdated} updated, ${sourcesSkipped} skipped`,
  );

  // Migrate messages collection
  console.log("\n2. Migrating messages collection...");
  const messagesSnapshot = await adminDb.collection("messages").get();
  console.log(`Found ${messagesSnapshot.size} messages`);

  let messagesUpdated = 0;
  let messagesSkipped = 0;

  for (const doc of messagesSnapshot.docs) {
    const data = doc.data();

    // Skip if locality already exists
    if (data.locality) {
      messagesSkipped++;
      continue;
    }

    if (!dryRun) {
      await doc.ref.update({ locality });
    }
    messagesUpdated++;

    if (messagesUpdated % 100 === 0) {
      console.log(`  Updated ${messagesUpdated} messages...`);
    }
  }

  console.log(
    `✓ Messages migration complete: ${messagesUpdated} updated, ${messagesSkipped} skipped`,
  );

  // Migrate events collection
  console.log("\n3. Migrating events collection...");
  const eventsSnapshot = await adminDb.collection("events").get();
  console.log(`Found ${eventsSnapshot.size} events`);

  let eventsUpdated = 0;
  let eventsSkipped = 0;

  for (const doc of eventsSnapshot.docs) {
    const data = doc.data();

    // Skip if locality already exists
    if (data.locality) {
      eventsSkipped++;
      continue;
    }

    if (!dryRun) {
      await doc.ref.update({ locality });
    }
    eventsUpdated++;

    if (eventsUpdated % 100 === 0) {
      console.log(`  Updated ${eventsUpdated} events...`);
    }
  }

  console.log(
    `✓ Events migration complete: ${eventsUpdated} updated, ${eventsSkipped} skipped`,
  );

  console.log("\n✓ Migration completed successfully!");
  console.log(`  Total sources updated: ${sourcesUpdated}`);
  console.log(`  Total messages updated: ${messagesUpdated}`);
  console.log(`  Total events updated: ${eventsUpdated}`);
  console.log(`  Locality used: ${locality}`);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
