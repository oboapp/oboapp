#!/usr/bin/env -S npx tsx

/**
 * Migration: Create 1:1 events from existing finalized messages.
 *
 * NOTE: Run this migration with ingestion paused (no active crawlers/pipeline)
 * to avoid race conditions between the existence pre-check and batch commit.
 *
 * For every finalized message (with geoJson OR cityWide=true), creates:
 * - An Event document (inherits geoJson, timespans, categories, text fields, etc.)
 * - An EventMessage link document (deterministic ID: messageId for idempotency)
 * - Updates the message with the eventId
 *
 * Idempotent: skips messages that already have an eventId set.
 * Paginated: processes messages in batches to avoid loading entire collection.
 *
 * Run with: cd db && npx tsx migrate/2026-03-15-create-events-from-messages.ts
 */

import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), "../ingest/.env.local") });

const BATCH_SIZE = 200;

/** Source trust map (duplicated from ingest to avoid cross-package import) */
const SOURCE_GEOMETRY_QUALITY: Record<string, number> = {
  "toplo-bg": 3,
  "sofiyska-voda": 3,
  "erm-zapad": 3,
  "nimh-severe-weather": 3,
  "sofia-bg": 2,
  "rayon-oborishte-bg": 2,
  "mladost-bg": 2,
  "studentski-bg": 2,
  "sredec-sofia-org": 2,
  "so-slatina-org": 2,
  "lozenets-sofia-bg": 2,
  "raioniskar-bg": 2,
  "rayon-ilinden-bg": 2,
  "rayon-pancharevo-bg": 2,
};

function getGeometryQuality(source: string): number {
  return SOURCE_GEOMETRY_QUALITY[source] ?? 0;
}

/**
 * Convert a Firestore Timestamp to ISO string.
 * Handles { _seconds, _nanoseconds } shape and toDate() method.
 */
function hasToDate(v: object): v is { toDate(): Date } {
  return "toDate" in v && typeof v.toDate === "function";
}

function hasSeconds(v: object): v is { _seconds: number } {
  return "_seconds" in v && typeof v._seconds === "number";
}

function convertTimestampToISO(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object" && value !== null) {
    if (hasToDate(value)) {
      return value.toDate().toISOString();
    }
    if (hasSeconds(value)) {
      return new Date(value._seconds * 1000).toISOString();
    }
  }

  return null;
}

/**
 * Parse a JSON string field (geoJson, addresses are stored as strings in Firestore).
 */
function parseJsonField(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value ?? null;
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

  console.log("Starting migration: create events from messages...\n");

  let eventsCreated = 0;
  let skippedNoGeoJson = 0;
  let skippedNotFinalized = 0;
  let skippedAlreadyLinked = 0;
  let totalProcessed = 0;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  // Paginate through messages using orderBy(__name__) + startAfter
  while (true) {
    let query = adminDb
      .collection("messages")
      .orderBy("__name__")
      .limit(BATCH_SIZE);

    if (lastDoc) {
      // Use the DocumentSnapshot as cursor — required for __name__ ordering
      // to avoid type mismatches with startAfter(string).
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    let batch = adminDb.batch();
    let batchCount = 0;

    // First pass: collect candidates, filtering out ineligible messages
    const messagesToProcess: {
      doc: FirebaseFirestore.QueryDocumentSnapshot;
      data: FirebaseFirestore.DocumentData;
      messageId: string;
      geoJson: unknown;
    }[] = [];

    for (const doc of snapshot.docs) {
      lastDoc = doc;
      totalProcessed++;
      const data = doc.data();
      const messageId = doc.id;

      if (!data.finalizedAt) {
        skippedNotFinalized++;
        continue;
      }

      const geoJson = parseJsonField(data.geoJson);
      const isCityWide = Boolean(data.cityWide);
      if (!geoJson && !isCityWide) {
        skippedNoGeoJson++;
        continue;
      }

      // Idempotent: skip messages already linked to an event.
      if (data.eventId) {
        skippedAlreadyLinked++;
        continue;
      }

      messagesToProcess.push({ doc, data, messageId, geoJson });
    }

    // Batch-check eventMessages existence for all candidates in this page
    // to avoid N+1 per-document reads.
    if (messagesToProcess.length > 0) {
      const eventMessageRefs = messagesToProcess.map((m) =>
        adminDb.collection("eventMessages").doc(m.messageId),
      );
      const existingLinks = await adminDb.getAll(...eventMessageRefs);
      // Build a map of messageId → existing link data for cache repair
      const existingLinksMap = new Map(
        existingLinks
          .filter((d) => d.exists)
          .map((d): [string, { eventId?: string }] => {
            const data: { eventId?: string } = d.data() ?? {};
            return [d.id, data];
          }),
      );

      for (const { doc, data, messageId, geoJson } of messagesToProcess) {
        if (existingLinksMap.has(messageId)) {
          // Link already exists — repair denormalized cache if message.eventId is missing
          if (!data.eventId) {
            const existingLink = existingLinksMap.get(messageId);
            if (existingLink?.eventId) {
              batch.update(doc.ref, { eventId: existingLink.eventId });
              batchCount++;
            }
          }
          skippedAlreadyLinked++;
          continue;
        }

        const now = new Date().toISOString();
        const source = typeof data.source === "string" ? data.source : "";
        // Only assign source-based quality when geometry is actually present
        const geometryQuality = geoJson ? getGeometryQuality(source) : 0;

        // Fallback timespans: prefer message timespans, fall back to
        // crawledAt/finalizedAt so events always have a usable timespanEnd
        // (required for findCandidates queries).
        const timespanStart =
          convertTimestampToISO(data.timespanStart) ||
          convertTimestampToISO(data.crawledAt) ||
          convertTimestampToISO(data.finalizedAt) ||
          now;
        const timespanEnd =
          convertTimestampToISO(data.timespanEnd) ||
          convertTimestampToISO(data.crawledAt) ||
          convertTimestampToISO(data.finalizedAt) ||
          now;

        // Create Event document — shape matches message closely
        const eventRef = adminDb.collection("events").doc();
        const eventData: Record<string, unknown> = {
          plainText: data.plainText || data.text || "",
          ...(data.markdownText ? { markdownText: data.markdownText } : {}),
          ...(geoJson ? { geoJson } : {}),
          geometryQuality,
          timespanStart,
          timespanEnd,
          categories: data.categories || [],
          ...(data.pins?.length ? { pins: data.pins } : {}),
          ...(data.streets?.length ? { streets: data.streets } : {}),
          ...(data.cadastralProperties?.length ? { cadastralProperties: data.cadastralProperties } : {}),
          ...(data.busStops?.length ? { busStops: data.busStops } : {}),
          sources: source ? [source] : [],
          messageCount: 1,
          confidence: 1.0,
          locality: data.locality || "bg.sofia",
          cityWide: data.cityWide || false,
          ...(data.embedding ? { embedding: data.embedding } : {}),
          createdAt: now,
          updatedAt: now,
        };
        batch.set(eventRef, eventData);

        // Create EventMessage link document (deterministic ID)
        const eventMessageRef = adminDb
          .collection("eventMessages")
          .doc(messageId);
        const eventMessageData = {
          eventId: eventRef.id,
          messageId,
          source,
          confidence: 1.0,
          geometryQuality,
          matchSignals: null,
          createdAt: now,
        };
        // Use create() so that a concurrent write from the live pipeline (between
        // the getAll() pre-check and batch.commit()) causes a hard failure rather
        // than silently overwriting an existing link. Run this migration with
        // ingestion paused; if it fails, re-run safely (idempotent via pre-check).
        batch.create(eventMessageRef, eventMessageData);

        // Store eventId on message
        batch.update(doc.ref, { eventId: eventRef.id });

        batchCount += 3;
        eventsCreated++;

        // Firestore batches can have at most 500 operations
        if (batchCount >= 498) {
          await batch.commit();
          console.log(`  Committed batch (${eventsCreated} events so far)...`);
          batch = adminDb.batch();
          batchCount = 0;
        }
      }
    }

    // Commit remaining operations in this page
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(
      `  Processed ${totalProcessed} messages (${eventsCreated} events created)...`,
    );

    // If we got fewer than BATCH_SIZE, we've reached the end
    if (snapshot.size < BATCH_SIZE) break;
  }

  console.log("\n✓ Migration completed successfully!");
  console.log(`  Total messages processed: ${totalProcessed}`);
  console.log(`  Events created: ${eventsCreated}`);
  console.log(`  Skipped (no geoJson): ${skippedNoGeoJson}`);
  console.log(`  Skipped (not finalized): ${skippedNotFinalized}`);
  console.log(`  Skipped (already linked): ${skippedAlreadyLinked}`);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
