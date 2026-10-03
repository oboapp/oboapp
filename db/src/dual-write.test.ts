import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient } from "./types";
import { DualWriteAdapter } from "./dual-write";

function createMockClient(name: string): DbClient {
  return {
    findOne: vi.fn().mockResolvedValue({ _id: `${name}-doc` }),
    findMany: vi.fn().mockResolvedValue([{ _id: `${name}-doc` }]),
    findPage: vi.fn().mockResolvedValue({ documents: [], nextCursor: null }),
    insertOne: vi.fn().mockResolvedValue(`${name}-id`),
    createOne: vi.fn().mockResolvedValue(`${name}-id`),
    updateOne: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(1),
    batchWrite: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(42),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("DualWriteAdapter", () => {
  let firestore: DbClient;
  let mongo: DbClient;

  beforeEach(() => {
    firestore = createMockClient("firestore");
    mongo = createMockClient("mongo");
  });

  describe("read routing", () => {
    it("reads from firestore when readSource is firestore", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);

      const result = await adapter.findOne("messages", "id-1");
      expect(result).toEqual({ _id: "firestore-doc" });
      expect(firestore.findOne).toHaveBeenCalledWith("messages", "id-1");
      expect(mongo.findOne).not.toHaveBeenCalled();
    });

    it("reads from mongo when readSource is mongodb", async () => {
      const adapter = new DualWriteAdapter("mongodb", firestore, mongo);

      const result = await adapter.findOne("messages", "id-1");
      expect(result).toEqual({ _id: "mongo-doc" });
      expect(mongo.findOne).toHaveBeenCalledWith("messages", "id-1");
      expect(firestore.findOne).not.toHaveBeenCalled();
    });

    it("findPage preserves the primary backend cursor", async () => {
      const adapter = new DualWriteAdapter("mongodb", firestore, mongo);
      const after = { backend: "mongodb" as const, value: { nativeId: true } };
      const result = { documents: [{ _id: "normalized" }], nextCursor: after };
      vi.mocked(mongo.findPage).mockResolvedValue(result);
      expect(await adapter.findPage("messages", { limit: 500, after })).toBe(result);
      expect(mongo.findPage).toHaveBeenCalledWith("messages", { limit: 500, after });
      expect(firestore.findPage).not.toHaveBeenCalled();
    });

    it("findMany reads from primary only", async () => {
      const adapter = new DualWriteAdapter("mongodb", firestore, mongo);
      const opts = {
        where: [{ field: "source", op: "==" as const, value: "test" }],
      };

      await adapter.findMany("messages", opts);
      expect(mongo.findMany).toHaveBeenCalledWith("messages", opts);
      expect(firestore.findMany).not.toHaveBeenCalled();
    });

    it("count reads from primary only", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      const where = [{ field: "active", op: "==" as const, value: true }];

      const result = await adapter.count("messages", where);
      expect(result).toBe(42);
      expect(firestore.count).toHaveBeenCalledWith("messages", where);
      expect(mongo.count).not.toHaveBeenCalled();
    });
  });

  describe("write routing", () => {
    it("insertOne writes to both, returns primary ID", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      const data = { text: "hello" };

      const id = await adapter.insertOne("messages", data, "custom-id");

      expect(id).toBe("firestore-id");
      expect(firestore.insertOne).toHaveBeenCalledWith(
        "messages",
        data,
        "custom-id",
      );
      // Secondary gets the ID from primary result
      expect(mongo.insertOne).toHaveBeenCalledWith(
        "messages",
        data,
        "firestore-id",
      );
    });

    it("createOne writes to both", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      const data = { text: "hello" };

      const id = await adapter.createOne("messages", data, "msg-1");

      expect(id).toBe("firestore-id");
      expect(firestore.createOne).toHaveBeenCalledWith(
        "messages",
        data,
        "msg-1",
      );
      expect(mongo.insertOne).toHaveBeenCalledWith("messages", data, "msg-1");
    });

    it("updateOne writes to both", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      const data = { text: "updated" };

      await adapter.updateOne("messages", "id-1", data);

      expect(firestore.updateOne).toHaveBeenCalledWith(
        "messages",
        "id-1",
        data,
      );
      expect(mongo.updateOne).toHaveBeenCalledWith("messages", "id-1", data);
    });

    it("deleteOne deletes from both", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);

      await adapter.deleteOne("messages", "id-1");

      expect(firestore.deleteOne).toHaveBeenCalledWith("messages", "id-1");
      expect(mongo.deleteOne).toHaveBeenCalledWith("messages", "id-1");
    });

    it("deleteMany deletes from both, returns primary count", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      const where = [{ field: "source", op: "==" as const, value: "test" }];

      const count = await adapter.deleteMany("messages", where);

      expect(count).toBe(1);
      expect(firestore.deleteMany).toHaveBeenCalledWith("messages", where);
      expect(mongo.deleteMany).toHaveBeenCalledWith("messages", where);
    });

    it("batchWrite writes to both", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      const ops = [
        {
          type: "set" as const,
          collection: "messages",
          id: "id-1",
          data: { text: "hi" },
        },
      ];

      await adapter.batchWrite(ops);

      expect(firestore.batchWrite).toHaveBeenCalledWith(ops);
      expect(mongo.batchWrite).toHaveBeenCalledWith(ops);
    });
  });

  describe("secondary failure tolerance", () => {
    it("insertOne succeeds when secondary fails", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      vi.mocked(mongo.insertOne).mockRejectedValue(new Error("mongo down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const id = await adapter.insertOne("messages", { text: "hello" });

      expect(id).toBe("firestore-id");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[dual-write] Secondary insertOne failed"),
        expect.any(String),
      );
      consoleSpy.mockRestore();
    });

    it("createOne succeeds when secondary fails", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      vi.mocked(mongo.insertOne).mockRejectedValue(
        new Error("already exists"),
      );
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const id = await adapter.createOne("messages", { text: "hello" }, "m-1");
      expect(id).toBe("firestore-id");
      consoleSpy.mockRestore();
    });

    it("updateOne succeeds when secondary fails", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      vi.mocked(mongo.updateOne).mockRejectedValue(new Error("mongo down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        adapter.updateOne("messages", "id-1", { text: "hi" }),
      ).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });

    it("deleteOne succeeds when secondary fails", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      vi.mocked(mongo.deleteOne).mockRejectedValue(new Error("mongo down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        adapter.deleteOne("messages", "id-1"),
      ).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });

    it("deleteMany succeeds when secondary fails", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      vi.mocked(mongo.deleteMany).mockRejectedValue(new Error("mongo down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const count = await adapter.deleteMany("messages", [
        { field: "source", op: "==", value: "x" },
      ]);
      expect(count).toBe(1);
      consoleSpy.mockRestore();
    });

    it("batchWrite succeeds when secondary fails", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      vi.mocked(mongo.batchWrite).mockRejectedValue(new Error("mongo down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(adapter.batchWrite([])).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });

    it("primary failure propagates (not caught)", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      vi.mocked(firestore.insertOne).mockRejectedValue(
        new Error("firestore down"),
      );

      await expect(
        adapter.insertOne("messages", { text: "hello" }),
      ).rejects.toThrow("firestore down");
    });
  });

  describe("close", () => {
    it("closes both clients", async () => {
      const adapter = new DualWriteAdapter("firestore", firestore, mongo);
      await adapter.close();
      expect(firestore.close).toHaveBeenCalled();
      expect(mongo.close).toHaveBeenCalled();
    });
  });

  describe("getReadSource", () => {
    it("returns the configured read source", () => {
      const adapter = new DualWriteAdapter("mongodb", firestore, mongo);
      expect(adapter.getReadSource()).toBe("mongodb");
    });
  });
});
