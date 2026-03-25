/**
 * Database initialization for the public API.
 *
 * Lazily creates and caches an OboDb instance.
 * Used by route handlers to access the database (read-only).
 */

import type { OboDb } from "@oboapp/db";

let _db: OboDb | null = null;

export async function getDb(): Promise<OboDb> {
  if (_db) return _db;

  const { createDb } = await import("@oboapp/db");

  let firestoreDb: import("firebase-admin/firestore").Firestore | undefined;

  const hasFirestore =
    !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    process.env.USE_FIREBASE_EMULATORS === "true" ||
    !!process.env.FIRESTORE_EMULATOR_HOST;

  if (hasFirestore) {
    // Dynamic import to ensure env vars are loaded before Firebase initializes
    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");

    if (getApps().length === 0) {
      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (serviceAccountKey) {
        initializeApp({
          credential: cert(JSON.parse(serviceAccountKey)),
        });
      } else {
        // Emulator mode
        initializeApp({
          projectId: process.env.FIREBASE_PROJECT_ID || "oboapp-dev",
        });
      }
    }

    firestoreDb = getFirestore();
  }

  _db = await createDb({ firestoreDb });
  return _db;
}
