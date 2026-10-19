import { describe, expect, it, vi } from "vitest";
import type { MongoClient } from "mongodb";
import { FirestoreAdapter } from "./firestore-adapter";
import { MongoAdapter } from "./mongo-adapter";

describe("Firestore conditional writes", () => {
  function setup(exists: boolean, data: Record<string, unknown>) {
    const ref = {};
    const tx = { get: vi.fn().mockResolvedValue({ exists, data: () => data }), update: vi.fn() };
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ref) })),
      runTransaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<boolean>) => callback(tx)),
    };
    return { adapter: new FirestoreAdapter(db as unknown as FirebaseFirestore.Firestore), db, tx, ref };
  }

  it("compares inside the transaction and applies the existing write transforms", async () => {
    const { adapter, tx, ref } = setup(true, { leaseToken: "old" });
    const geoJson = { type: "FeatureCollection", features: [] };
    expect(await adapter.compareAndUpdate("sources", "id", "leaseToken", "old", { leaseToken: "new", geoJson })).toBe(true);
    expect(tx.get).toHaveBeenCalledWith(ref);
    expect(tx.update).toHaveBeenCalledWith(ref, { leaseToken: "new", geoJson: JSON.stringify(geoJson) });
  });

  it.each([
    { exists: false, data: { leaseToken: "old" } },
    { exists: true, data: {} },
    { exists: true, data: { leaseToken: "other" } },
    { exists: true, data: { leaseToken: ["old"] } },
  ])("does not write a missing/stale/non-string token: %j", async ({ exists, data }) => {
    const { adapter, tx } = setup(exists, data);
    expect(await adapter.compareAndUpdate("pending", "id", "leaseToken", "old", { leaseToken: "new" })).toBe(false);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("propagates storage errors instead of returning a lost-claim result", async () => {
    const { adapter, tx } = setup(true, { leaseToken: "old" });
    tx.get.mockRejectedValue(new Error("offline"));
    await expect(adapter.compareAndUpdate("pending", "id", "leaseToken", "old", { leaseToken: "new" })).rejects.toThrow("offline");
  });

  it("rechecks the token when Firestore retries a conflicted transaction", async () => {
    const { adapter, db, tx } = setup(true, { leaseToken: "old" });
    db.runTransaction.mockImplementation(async (callback) => {
      await callback(tx); // First attempt is discarded by the transaction engine.
      tx.update.mockClear();
      tx.get.mockResolvedValue({ exists: true, data: () => ({ leaseToken: "winner" }) });
      return callback(tx);
    });
    expect(await adapter.compareAndUpdate("pending", "id", "leaseToken", "old", { leaseToken: "new" })).toBe(false);
    expect(tx.get).toHaveBeenCalledTimes(2);
    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe("Mongo conditional writes", () => {
  function setup() {
    const updateOne = vi.fn();
    const client = { db: () => ({ collection: () => ({ updateOne }) }) };
    return { adapter: new MongoAdapter(client as unknown as MongoClient, "oboapp"), updateOne };
  }

  it("uses one conditional write with literal byte-sensitive token comparison", async () => {
    const { adapter, updateOne } = setup();
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
    expect(await adapter.compareAndUpdate("pending", "id", "leaseToken", "$old", { leaseToken: "new" })).toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "id", $expr: { $eq: ["$leaseToken", { $literal: "$old" }] } },
      { $set: { leaseToken: "new" } },
      { collation: { locale: "simple" } },
    );
  });

  it("returns false on a lost claim without upserting", async () => {
    const { adapter, updateOne } = setup();
    updateOne.mockResolvedValue({ matchedCount: 0 });
    expect(await adapter.compareAndUpdate("pending", "id", "leaseToken", "old", { leaseToken: "new" })).toBe(false);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("propagates storage errors", async () => {
    const { adapter, updateOne } = setup();
    updateOne.mockRejectedValue(new Error("offline"));
    await expect(adapter.compareAndUpdate("pending", "id", "leaseToken", "old", { leaseToken: "new" })).rejects.toThrow("offline");
  });
});
