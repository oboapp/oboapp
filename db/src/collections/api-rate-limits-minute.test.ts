import { describe, it, expect } from "vitest";
import type { DbClient } from "../types";
import {
  ApiRateLimitsMinuteRepository,
  makeBucketId,
  isAlreadyExistsError,
} from "./api-rate-limits-minute";

describe("api-rate-limits-minute pure helpers", () => {
  it("makeBucketId combines principal and period", () => {
    expect(makeBucketId("user-1", "2026-06-16T12:34:00.000Z")).toBe(
      "user-1:2026-06-16T12:34:00.000Z",
    );
  });

  it("isAlreadyExistsError returns true for known duplicate indicators", () => {
    expect(isAlreadyExistsError(new Error("document already exists"))).toBe(
      true,
    );
    expect(isAlreadyExistsError(new Error("ALREADY_EXISTS"))).toBe(true);

    const code6 = new Error("db");
    (code6 as Error & { code?: unknown }).code = 6;
    expect(isAlreadyExistsError(code6)).toBe(true);

    const code11000 = new Error("duplicate key");
    (code11000 as Error & { code?: unknown }).code = 11000;
    expect(isAlreadyExistsError(code11000)).toBe(true);
  });

  it("isAlreadyExistsError returns false for unrelated input", () => {
    expect(isAlreadyExistsError(new Error("connection refused"))).toBe(false);
    expect(isAlreadyExistsError("already exists" as unknown)).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
  });

  it("preserves adapter binding for atomic increments", async () => {
    const state = { requestCount: 1 };

    const client: DbClient & {
      incrementFieldAndGet: (
        collection: string,
        id: string,
        field: string,
        amount: number,
        setFields?: Record<string, unknown>,
      ) => Promise<number>;
      state: typeof state;
    } = {
      state,
      async findOne() {
        return null;
      },
      async findMany() {
        return [];
      },
      async insertOne() {
        return "unused";
      },
      async createOne() {
        throw new Error("already exists");
      },
      async updateOne() {
        throw new Error("updateOne should not be called");
      },
      async deleteOne() {
        throw new Error("unused");
      },
      async deleteMany() {
        throw new Error("unused");
      },
      async batchWrite() {
        throw new Error("unused");
      },
      async count() {
        throw new Error("unused");
      },
      async close() {},
      async incrementFieldAndGet(collection, id, field, amount, setFields) {
        expect(this.state.requestCount).toBe(1);
        expect(collection).toBe("apiRateLimitsMinute");
        expect(id).toBe("client-1:2026-06-18T10:20:00.000Z");
        expect(field).toBe("requestCount");
        expect(amount).toBe(1);
        expect(setFields).toEqual({ updatedAt: "2026-06-18T10:20:45.000Z" });

        this.state.requestCount += amount;
        return this.state.requestCount;
      },
    };

    const repository = new ApiRateLimitsMinuteRepository(client);

    await expect(
      repository.incrementAndGetCount({
        principalId: "client-1",
        periodStart: "2026-06-18T10:20:00.000Z",
        nowIso: "2026-06-18T10:20:45.000Z",
      }),
    ).resolves.toBe(2);
  });
});
