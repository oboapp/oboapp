/**
 * Firestore → MongoDB migration script.
 *
 * Reads all documents from each Firestore collection, transforms Firestore-specific
 * types to MongoDB-native types, and bulk-upserts into MongoDB.
 *
 * Idempotent — safe to re-run. Uses upsert to avoid duplicates.
 *
 * Usage:
 *   cd db && npx tsx migrate/2026-02-13-firestore-to-mongo.ts
 *
 * Required env vars:
 *   FIREBASE_SERVICE_ACCOUNT_KEY — Firestore credentials
 *   MONGODB_URI — MongoDB connection string
 *   MONGODB_DATABASE — MongoDB database name (default: "oboapp")
 */

import dotenv from "dotenv";
import { resolve } from "node:path";

// Load env from ingest/.env.local
dotenv.config({ path: resolve(process.cwd(), "../ingest/.env.local") });

import { MongoClient, type Document } from "mongodb";

/** Collections to migrate */
const COLLECTIONS = [
  "messages",
  "sources",
  "interests",
  "notificationSubscriptions",
  "notificationMatches",
  "gtfsStops",
  "events",
  "eventMessages",
] as const;

/** Fields that are stored as JSON strings in Firestore but should be native objects in MongoDB */
const JSON_STRING_FIELDS = new Set(["geoJson", "addresses", "ingestErrors"]);

/**
 * Convert a Firestore Timestamp or timestamp-like object to a Date.
 */
function hasToDate(v: object): v is { toDate(): Date } {
  return "toDate" in v && typeof v.toDate === "function";
}

function hasSeconds(v: object): v is { _seconds: number } {
  return "_seconds" in v && typeof v._seconds === "number";
}

function convertTimestamp(value: unknown): Date | unknown {
  if (!value) return value;
  if (value instanceof Date) return value;

  if (typeof value === "object" && value !== null) {
    if (hasSeconds(value)) {
      return new Date(value._seconds * 1000);
    }
    if (hasToDate(value)) {
      return value.toDate();
    }
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) return new Date(parsed);
  }

  return value;
}

/** Timestamp field names that should be converted to Date */
const TIMESTAMP_FIELDS = new Set([
  "createdAt",
  "crawledAt",
  "finalizedAt",
  "timespanStart",
  "timespanEnd",
  "notifiedAt",
  "lastUpdated",
  "updatedAt",
]);

/**
 * Transform a single Firestore document to MongoDB format.
 * - Parses JSON string fields to native objects
 * - Converts Firestore Timestamps to Date objects
 * - Sets _id to the Firestore document ID
 */
function transformDocument(
  docId: string,
  data: Record<string, unknown>,
): Document {
  const result: Document = { _id: docId };

  for (const [key, value] of Object.entries(data)) {
    // Parse JSON string fields
    if (JSON_STRING_FIELDS.has(key) && typeof value === "string") {
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
      continue;
    }

    // Convert timestamp fields
    if (TIMESTAMP_FIELDS.has(key)) {
      result[key] = convertTimestamp(value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

async function migrate(): Promise<void> {
  // Dynamically import firebase-admin (dotenv must be loaded first)
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

  const mongoUri = process.env.MONGODB_URI;
  const mongoDatabase = process.env.MONGODB_DATABASE ?? "oboapp";

  if (!mongoUri) {
    throw new Error("MONGODB_URI environment variable is required");
  }

  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db(mongoDatabase);

  console.log("Starting Firestore → MongoDB migration...\n");

  const summary: {
    collection: string;
    firestore: number;
    mongodb: number;
    status: string;
  }[] = [];

  for (const collectionName of COLLECTIONS) {
    console.log(`\n--- Migrating: ${collectionName} ---`);

    // Read all documents from Firestore
    const snapshot = await adminDb.collection(collectionName).get();
    const firestoreCount = snapshot.size;
    console.log(`  Firestore documents: ${firestoreCount}`);

    if (firestoreCount === 0) {
      summary.push({
        collection: collectionName,
        firestore: 0,
        mongodb: 0,
        status: "skipped (empty)",
      });
      continue;
    }

    // Transform and prepare MongoDB documents
    const mongoDocs: Document[] = [];
    for (const doc of snapshot.docs) {
      const transformed = transformDocument(doc.id, doc.data());
      mongoDocs.push(transformed);
    }

    // Bulk upsert into MongoDB (idempotent)
    const col = db.collection(collectionName);
    const bulkOps = mongoDocs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: doc },
        upsert: true,
      },
    }));

    const result = await col.bulkWrite(bulkOps);
    console.log(
      `  MongoDB: ${result.upsertedCount} inserted, ${result.modifiedCount} updated`,
    );

    // Verify counts
    const mongoCount = await col.countDocuments();
    const status =
      mongoCount >= firestoreCount ? "OK" : `MISMATCH (mongo: ${mongoCount})`;
    console.log(`  MongoDB documents: ${mongoCount} — ${status}`);

    summary.push({
      collection: collectionName,
      firestore: firestoreCount,
      mongodb: mongoCount,
      status,
    });
  }

  // Print summary
  console.log("\n\n=== Migration Summary ===\n");
  console.table(summary);

  const allOk = summary.every(
    (s) => s.status === "OK" || s.status === "skipped (empty)",
  );
  console.log(
    `\nOverall: ${allOk ? "SUCCESS" : "SOME COLLECTIONS NEED ATTENTION"}`,
  );

  await mongoClient.close();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
