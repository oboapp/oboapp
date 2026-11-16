import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the adapters so we don't need real Firestore/MongoDB connections
vi.mock("./firestore-adapter", () => {
  const MockFirestoreAdapter = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      findOne: vi.fn(),
      findMany: vi.fn(),
      insertOne: vi.fn(),
      createOne: vi.fn(),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
      deleteMany: vi.fn(),
      batchWrite: vi.fn(),
      count: vi.fn(),
      close: vi.fn(),
    });
  });
  return { FirestoreAdapter: MockFirestoreAdapter };
});

vi.mock("./mongo-adapter", () => ({
  MongoAdapter: {
    connect: vi.fn().mockResolvedValue({
      findOne: vi.fn(),
      findMany: vi.fn(),
      insertOne: vi.fn(),
      createOne: vi.fn(),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
      deleteMany: vi.fn(),
      batchWrite: vi.fn(),
      count: vi.fn(),
      close: vi.fn(),
    }),
  },
}));

vi.mock("./dual-write", () => {
  const MockDualWriteAdapter = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      findOne: vi.fn(),
      findMany: vi.fn(),
      insertOne: vi.fn(),
      createOne: vi.fn(),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
      deleteMany: vi.fn(),
      batchWrite: vi.fn(),
      count: vi.fn(),
      close: vi.fn(),
    });
  });
  return { DualWriteAdapter: MockDualWriteAdapter };
});

import { createDbFromConfig, createDb } from "./index";
import { FirestoreAdapter } from "./firestore-adapter";
import { MongoAdapter } from "./mongo-adapter";
import { DualWriteAdapter } from "./dual-write";

describe("createDbFromConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates FirestoreAdapter when only firestoreDb is provided", async () => {
    const fakeFirestore = {} as FirebaseFirestore.Firestore;
    const db = await createDbFromConfig({
      readSource: "firestore",
      firestoreDb: fakeFirestore,
    });

    expect(FirestoreAdapter).toHaveBeenCalledWith(fakeFirestore);
    expect(MongoAdapter.connect).not.toHaveBeenCalled();
    expect(DualWriteAdapter).not.toHaveBeenCalled();
    expect(db.messages).toBeDefined();
    expect(db.sources).toBeDefined();
    expect(db.sourceSnapshots).toBeDefined();
    expect(db.interests).toBeDefined();
    expect(db.notificationMatches).toBeDefined();
    expect(db.notificationSubscriptions).toBeDefined();
    expect(db.gtfsStops).toBeDefined();
    expect(db.userPreferences).toBeDefined();
    expect(typeof db.close).toBe("function");
  });

  it("creates MongoAdapter when only mongoUri is provided", async () => {
    const db = await createDbFromConfig({
      readSource: "mongodb",
      mongoUri: "mongodb://localhost:27017",
      mongoDatabase: "test-db",
    });

    expect(MongoAdapter.connect).toHaveBeenCalledWith(
      "mongodb://localhost:27017",
      "test-db",
    );
    expect(FirestoreAdapter).not.toHaveBeenCalled();
    expect(DualWriteAdapter).not.toHaveBeenCalled();
    expect(db.messages).toBeDefined();
  });

  it("uses default database name 'oboapp' when mongoDatabase is not provided", async () => {
    await createDbFromConfig({
      readSource: "mongodb",
      mongoUri: "mongodb://localhost:27017",
    });

    expect(MongoAdapter.connect).toHaveBeenCalledWith(
      "mongodb://localhost:27017",
      "oboapp",
    );
  });

  it("creates DualWriteAdapter when both firestoreDb and mongoUri are provided", async () => {
    const fakeFirestore = {} as FirebaseFirestore.Firestore;
    const db = await createDbFromConfig({
      readSource: "firestore",
      firestoreDb: fakeFirestore,
      mongoUri: "mongodb://localhost:27017",
      mongoDatabase: "oboapp",
    });

    expect(FirestoreAdapter).toHaveBeenCalledWith(fakeFirestore);
    expect(MongoAdapter.connect).toHaveBeenCalledWith(
      "mongodb://localhost:27017",
      "oboapp",
    );
    expect(DualWriteAdapter).toHaveBeenCalled();
    expect(db.messages).toBeDefined();
  });

  it("throws when neither firestoreDb nor mongoUri is provided", async () => {
    await expect(
      createDbFromConfig({ readSource: "firestore" }),
    ).rejects.toThrow("No database configured");
  });
});

describe("createDb", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reads DB_READ_SOURCE from env, defaults to firestore", async () => {
    delete process.env.DB_READ_SOURCE;
    delete process.env.MONGODB_URI;

    // Must provide firestoreDb since no mongo
    const fakeFirestore = {} as FirebaseFirestore.Firestore;
    const db = await createDb({ firestoreDb: fakeFirestore });

    expect(FirestoreAdapter).toHaveBeenCalledWith(fakeFirestore);
    expect(db.messages).toBeDefined();
  });

  it("connects to MongoDB when MONGODB_URI is set", async () => {
    process.env.MONGODB_URI = "mongodb://localhost:27017";
    process.env.MONGODB_DATABASE = "custom-db";
    delete process.env.DB_READ_SOURCE;

    // Both env vars + firestoreDb → dual-write
    const fakeFirestore = {} as FirebaseFirestore.Firestore;
    const db = await createDb({ firestoreDb: fakeFirestore });

    expect(MongoAdapter.connect).toHaveBeenCalledWith(
      "mongodb://localhost:27017",
      "custom-db",
    );
    expect(db.messages).toBeDefined();
  });

  it("uses 'oboapp' as default MONGODB_DATABASE", async () => {
    process.env.MONGODB_URI = "mongodb://localhost:27017";
    delete process.env.MONGODB_DATABASE;

    await createDb();

    expect(MongoAdapter.connect).toHaveBeenCalledWith(
      "mongodb://localhost:27017",
      "oboapp",
    );
  });

  it("throws when no database is configured", async () => {
    delete process.env.MONGODB_URI;
    await expect(createDb()).rejects.toThrow("No database configured");
  });

  it("throws on invalid DB_READ_SOURCE value", async () => {
    process.env.DB_READ_SOURCE = "invalid-source";
    await expect(createDb()).rejects.toThrow("Invalid DB_READ_SOURCE");
  });
});
