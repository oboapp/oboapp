import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";
import { logger } from "@/lib/logger";

/**
 * Lazy Firebase Admin initialization.
 *
 * The module no longer throws at import time when FIREBASE_SERVICE_ACCOUNT_KEY
 * is absent (MongoDB-only mode). Errors are deferred until an exported value is
 * actually accessed via the proxy objects below.
 */

let _adminApp: App | undefined;
let _adminDb: Firestore | undefined;
let _adminAuth: Auth | undefined;
let _initError: Error | null = null;
let _initialized = false;

function initialize(): void {
  if (_initialized) return;
  _initialized = true;

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const useEmulators =
    process.env.USE_FIREBASE_EMULATORS === "true" || Boolean(emulatorHost);

  try {
    if (!getApps().length) {
      if (useEmulators) {
        // Emulator mode - no credentials needed
        logger.info("Firebase Admin using emulators");
        _adminApp = initializeApp({
          projectId: process.env.FIREBASE_PROJECT_ID || "demo-project",
        });
      } else {
        // Production mode - use service account key from environment
        if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
          logger.warn(
            "Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_KEY missing) — running in MongoDB-only mode",
          );
          _initError = new Error(
            "FIREBASE_SERVICE_ACCOUNT_KEY environment variable is required. " +
              "Please add your Firebase service account JSON to .env.local",
          );
          return;
        }
        try {
          const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
          );
          _adminApp = initializeApp({
            credential: cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID,
          });
        } catch (error) {
          logger.error("Error parsing FIREBASE_SERVICE_ACCOUNT_KEY", {
            error: error instanceof Error ? error.message : String(error),
          });
          _initError = new Error(
            "Failed to initialize Firebase Admin SDK: Invalid service account JSON",
          );
          return;
        }
      }
    } else {
      _adminApp = getApps()[0];
    }

    const databaseId = process.env.FIREBASE_DATABASE_ID;
    _adminDb = databaseId
      ? getFirestore(_adminApp, databaseId)
      : getFirestore(_adminApp);
    _adminAuth = getAuth(_adminApp);

    // In emulator mode, ensure we connect to the emulator
    if (useEmulators) {
      const [host, port] = (emulatorHost || "localhost:8080").split(":");
      _adminDb.settings({
        host: `${host}:${port}`,
        ssl: false,
      });
    }
  } catch (error) {
    _initError = error instanceof Error ? error : new Error(String(error));
  }
}

function makeProxy(label: "adminApp"): App;
function makeProxy(label: "adminDb"): Firestore;
function makeProxy(label: "adminAuth"): Auth;
function makeProxy(
  label: "adminApp" | "adminDb" | "adminAuth",
): App | Firestore | Auth {
  return new Proxy<App | Firestore | Auth>(Object.create(null), {
    get(_target, prop) {
      initialize();
      const instance =
        label === "adminDb"
          ? _adminDb
          : label === "adminAuth"
            ? _adminAuth
            : _adminApp;
      if (!instance) {
        throw _initError ?? new Error(`Firebase ${label} is not available`);
      }
      const value = Reflect.get(instance, prop);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  });
}

export const adminApp = makeProxy("adminApp");
export const adminDb = makeProxy("adminDb");
export const adminAuth = makeProxy("adminAuth");
