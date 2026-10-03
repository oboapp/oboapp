import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { MongoAdapter } from "./mongo-adapter";
import type { DbPageCursor } from "./types";

// Opt in with a disposable local MongoDB instance; never use application data.
const uri = process.env.DB_TEST_MONGODB_URI;

describe.skipIf(!uri)("MongoDB native-ID pagination", () => {
  it("reads every notified record across string/ObjectId boundaries and full pages", async () => {
    const adapter = await MongoAdapter.connect(
      uri!,
      `pagination_test_${randomUUID().replaceAll("-", "")}`,
    );
    try {
      const ids = Array.from({ length: 501 }, () => new ObjectId());
      const collection = adapter.getDb().collection("notificationMatches");
      // Include a hex string identical to an ObjectId's normalized public ID.
      const strings = [
        ...Array.from({ length: 499 }, (_, i) => `string-${i}`),
        ids[0].toHexString(),
      ];
      await collection.insertMany([
        ...strings.map((_id, ordinal) => ({ _id, ordinal, notified: true })),
        ...ids.map((_id, i) => ({
          _id,
          ordinal: i + strings.length,
          notified: true,
        })),
        { _id: new ObjectId(), ordinal: -1, notified: false },
      ]);
      const ordinals = new Set<number>();
      const sizes: number[] = [];
      let after: DbPageCursor | undefined;
      do {
        const page = await adapter.findPage("notificationMatches", {
          where: [{ field: "notified", op: "==", value: true }],
          limit: 500,
          select: ["ordinal"],
          after,
        });
        sizes.push(page.documents.length);
        for (const doc of page.documents) {
          expect(ordinals.has(Number(doc.ordinal))).toBe(false);
          ordinals.add(Number(doc.ordinal));
        }
        after = page.nextCursor ?? undefined;
        if (page.documents.length < 500) break;
      } while (after);
      expect(sizes).toEqual([500, 500, 1]);
      expect(ordinals.size).toBe(1001);
      expect(ordinals.has(-1)).toBe(false);
    } finally {
      await adapter.getDb().dropDatabase();
      await adapter.close();
    }
  }, 20_000);
});
