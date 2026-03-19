/**
 * @oboapp/db — Database abstraction layer
 *
 * Provides a unified interface over Firestore and MongoDB with dual-write support.
 *
 * Usage:
 *   import { createDb } from "@oboapp/db";
 *   const db = await createDb();
 *   const message = await db.messages.findById("abc123");
 */

import type { DbClient, DbConfig, DbBackend } from "./types";
import { FirestoreAdapter } from "./firestore-adapter";
import { MongoAdapter } from "./mongo-adapter";
import { DualWriteAdapter } from "./dual-write";
import { MessagesRepository } from "./collections/messages";
import { SourcesRepository } from "./collections/sources";
import { InterestsRepository } from "./collections/interests";
import { NotificationMatchesRepository } from "./collections/notification-matches";
import { NotificationSubscriptionsRepository } from "./collections/notification-subscriptions";
import { GtfsStopsRepository } from "./collections/gtfs-stops";
import { ApiClientsRepository } from "./collections/api-clients";
import { UserPreferencesRepository } from "./collections/user-preferences";
import { EventsRepository } from "./collections/events";
import { EventMessagesRepository } from "./collections/event-messages";

/** High-level database interface with typed collection repositories */
export interface OboDb {
  /** Raw DbClient for advanced operations */
  client: DbClient;
  /** Messages collection */
  messages: MessagesRepository;
  /** Sources collection */
  sources: SourcesRepository;
  /** Interests collection */
  interests: InterestsRepository;
  /** Notification matches collection */
  notificationMatches: NotificationMatchesRepository;
  /** Notification subscriptions collection */
  notificationSubscriptions: NotificationSubscriptionsRepository;
  /** GTFS stops collection */
  gtfsStops: GtfsStopsRepository;
  /** Registered external API clients */
  apiClients: ApiClientsRepository;
  /** User preferences (notification filters, etc.) */
  userPreferences: UserPreferencesRepository;
  /** Aggregated real-world events */
  events: EventsRepository;
  /** Message-to-event links */
  eventMessages: EventMessagesRepository;
  /** Close all database connections */
  close(): Promise<void>;
}

function isDbBackend(value: string): value is DbBackend {
  return value === "firestore" || value === "mongodb";
}

function resolveReadSource(value = "firestore"): DbBackend {
  const readSource = value;
  if (!isDbBackend(readSource)) {
    throw new Error(
      `Invalid DB_READ_SOURCE: ${readSource}. Expected 'firestore' or 'mongodb'.`,
    );
  }
  return readSource;
}

function buildRepositories(client: DbClient): OboDb {
  return {
    client,
    messages: new MessagesRepository(client),
    sources: new SourcesRepository(client),
    interests: new InterestsRepository(client),
    notificationMatches: new NotificationMatchesRepository(client),
    notificationSubscriptions: new NotificationSubscriptionsRepository(client),
    gtfsStops: new GtfsStopsRepository(client),
    apiClients: new ApiClientsRepository(client),
    userPreferences: new UserPreferencesRepository(client),
    events: new EventsRepository(client),
    eventMessages: new EventMessagesRepository(client),
    close: () => client.close(),
  };
}

/**
 * Create a database instance from explicit config.
 *
 * For most callers, use `createDb()` which reads from environment variables.
 */
function assertFirestoreDb(
  db: unknown,
): asserts db is FirebaseFirestore.Firestore {
  if (!db || typeof db !== "object") {
    throw new Error("firestoreDb must be a valid Firestore instance");
  }
}

export async function createDbFromConfig(config: DbConfig): Promise<OboDb> {
  const readSource = resolveReadSource(config.readSource);
  const hasFirestore = !!config.firestoreDb;
  const hasMongo = !!config.mongoUri;

  // Dual-write: both backends available
  if (hasFirestore && hasMongo) {
    assertFirestoreDb(config.firestoreDb);
    const firestoreAdapter = new FirestoreAdapter(config.firestoreDb);
    const mongoAdapter = await MongoAdapter.connect(
      config.mongoUri!,
      config.mongoDatabase ?? "oboapp",
    );
    const dualWrite = new DualWriteAdapter(
      readSource,
      firestoreAdapter,
      mongoAdapter,
    );
    return buildRepositories(dualWrite);
  }

  // Firestore only
  if (hasFirestore) {
    assertFirestoreDb(config.firestoreDb);
    const firestoreAdapter = new FirestoreAdapter(config.firestoreDb);
    return buildRepositories(firestoreAdapter);
  }

  // MongoDB only
  if (hasMongo) {
    const mongoAdapter = await MongoAdapter.connect(
      config.mongoUri!,
      config.mongoDatabase ?? "oboapp",
    );
    return buildRepositories(mongoAdapter);
  }

  throw new Error(
    "No database configured. Provide firestoreDb and/or mongoUri in DbConfig.",
  );
}

/**
 * Create a database instance from environment variables.
 *
 * Env vars:
 *   MONGODB_URI — MongoDB connection string
 *   MONGODB_DATABASE — MongoDB database name (default: "oboapp")
 *   DB_READ_SOURCE — "firestore" | "mongodb" (default: "firestore")
 *
 * Firestore must be provided via the `firestoreDb` option since it requires
 * dynamic import of firebase-admin (dotenv must load first).
 */
export async function createDb(options?: {
  firestoreDb?: unknown;
}): Promise<OboDb> {
  const readSource = resolveReadSource(process.env.DB_READ_SOURCE);
  const mongoUri = process.env.MONGODB_URI;
  const mongoDatabase = process.env.MONGODB_DATABASE ?? "oboapp";

  return createDbFromConfig({
    readSource,
    mongoUri,
    mongoDatabase,
    firestoreDb: options?.firestoreDb,
  });
}

// Re-export types and adapters
export type { DbClient, DbConfig, DbBackend } from "./types";
export type {
  WhereClause,
  OrderByClause,
  FindManyOptions,
  BatchOperation,
  UpdateOperators,
} from "./types";
export { MongoAdapter } from "./mongo-adapter";
export { DualWriteAdapter } from "./dual-write";
export {
  transformForFirestoreWrite,
  transformFromFirestoreRead,
} from "./firestore-transforms";
export { ensureIndexes, listIndexes, INDEX_DEFINITIONS } from "./indexes";
export * from "./collections";
