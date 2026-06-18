/**
 * Per-principal fixed-window rate limit counters (minute buckets).
 */

import type { DbClient } from "../types";

type IncrementFieldAndGetCapable = {
  incrementFieldAndGet(
    collection: string,
    id: string,
    field: string,
    amount: number,
    setFields?: Record<string, unknown>,
  ): Promise<number>;
};

function getIncrementFieldAndGet(
  db: DbClient,
): IncrementFieldAndGetCapable["incrementFieldAndGet"] | null {
  const candidate: unknown = Reflect.get(db, "incrementFieldAndGet");
  if (typeof candidate !== "function") {
    return null;
  }

  return async (collection, id, field, amount, setFields) => {
    const result = await Reflect.apply(candidate, db, [
      collection,
      id,
      field,
      amount,
      setFields,
    ]);
    if (typeof result !== "number") {
      throw new TypeError("incrementFieldAndGet must return a number");
    }
    return result;
  };
}

/** Collection name constant */
export const API_RATE_LIMITS_MINUTE_COLLECTION = "apiRateLimitsMinute";

export function makeBucketId(principalId: string, periodStart: string): string {
  return `${principalId}:${periodStart}`;
}

export function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = Reflect.get(error, "code");
  return (
    error.message.includes("already exists") ||
    error.message.includes("ALREADY_EXISTS") ||
    maybeCode === 6 ||
    maybeCode === 11000
  );
}

export class ApiRateLimitsMinuteRepository {
  constructor(private readonly db: DbClient) {}

  async incrementAndGetCount(params: {
    principalId: string;
    periodStart: string;
    nowIso: string;
  }): Promise<number> {
    const { principalId, periodStart, nowIso } = params;
    const bucketId = makeBucketId(principalId, periodStart);

    try {
      await this.db.createOne(
        API_RATE_LIMITS_MINUTE_COLLECTION,
        {
          principalId,
          periodStart,
          requestCount: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        bucketId,
      );
      return 1;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    const incrementFieldAndGet = getIncrementFieldAndGet(this.db);
    if (incrementFieldAndGet) {
      return incrementFieldAndGet(
        API_RATE_LIMITS_MINUTE_COLLECTION,
        bucketId,
        "requestCount",
        1,
        { updatedAt: nowIso },
      );
    }

    await this.db.updateOne(API_RATE_LIMITS_MINUTE_COLLECTION, bucketId, {
      $inc: { requestCount: 1 },
      $set: { updatedAt: nowIso },
    });

    const updated = await this.db.findOne(
      API_RATE_LIMITS_MINUTE_COLLECTION,
      bucketId,
    );
    const count =
      typeof updated?.requestCount === "number" ? updated.requestCount : null;
    if (count === null) {
      throw new Error(
        "Rate limit bucket update did not produce a numeric requestCount",
      );
    }

    return count;
  }
}
