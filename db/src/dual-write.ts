/**
 * Dual-write adapter — writes to both Firestore and MongoDB,
 * reads from the configured primary source.
 *
 * Stage 1: DB_READ_SOURCE=firestore → reads from Firestore, writes to both
 * Stage 2: DB_READ_SOURCE=mongodb → reads from MongoDB, writes to both
 */

import type {
  DbClient,
  DbBackend,
  FindManyOptions,
  WhereClause,
  BatchOperation,
  UpdateOperators,
} from "./types";

async function tryIncrementFieldAndGet(
  client: DbClient,
  collection: string,
  id: string,
  field: string,
  amount: number,
  setFields?: Record<string, unknown>,
): Promise<number | null> {
  const candidate: unknown = Reflect.get(client, "incrementFieldAndGet");
  if (typeof candidate !== "function") {
    return null;
  }

  const result = await Reflect.apply(candidate, client, [
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
}

export class DualWriteAdapter implements DbClient {
  private readonly primary: DbClient;
  private readonly secondary: DbClient;

  constructor(
    private readonly readSource: DbBackend,
    private readonly firestore: DbClient,
    private readonly mongo: DbClient,
  ) {
    this.primary = readSource === "firestore" ? firestore : mongo;
    this.secondary = readSource === "firestore" ? mongo : firestore;
  }

  /** Get the current read source */
  getReadSource(): DbBackend {
    return this.readSource;
  }

  // --- Reads: delegated to primary ---

  async findOne(
    collection: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    return this.primary.findOne(collection, id);
  }

  async findMany(
    collection: string,
    options?: FindManyOptions,
  ): Promise<Record<string, unknown>[]> {
    return this.primary.findMany(collection, options);
  }

  async count(collection: string, where?: WhereClause[]): Promise<number> {
    return this.primary.count(collection, where);
  }

  // --- Writes: go to both, primary first ---

  async insertOne(
    collection: string,
    data: Record<string, unknown>,
    id?: string,
  ): Promise<string> {
    const resultId = await this.primary.insertOne(collection, data, id);
    try {
      await this.secondary.insertOne(collection, data, resultId);
    } catch (err) {
      console.error(
        `[dual-write] Secondary insertOne failed for ${collection}/${resultId}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return resultId;
  }

  async createOne(
    collection: string,
    data: Record<string, unknown>,
    id: string,
  ): Promise<string> {
    const resultId = await this.primary.createOne(collection, data, id);
    try {
      // Use insertOne on secondary (don't fail if already exists there)
      await this.secondary.insertOne(collection, data, id);
    } catch (err) {
      console.error(
        `[dual-write] Secondary createOne failed for ${collection}/${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return resultId;
  }

  async updateOne(
    collection: string,
    id: string,
    data: Record<string, unknown> | UpdateOperators,
  ): Promise<void> {
    await this.primary.updateOne(collection, id, data);
    try {
      await this.secondary.updateOne(collection, id, data);
    } catch (err) {
      console.error(
        `[dual-write] Secondary updateOne failed for ${collection}/${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async incrementFieldAndGet(
    collection: string,
    id: string,
    field: string,
    amount: number,
    setFields?: Record<string, unknown>,
  ): Promise<number> {
    const value = await tryIncrementFieldAndGet(
      this.primary,
      collection,
      id,
      field,
      amount,
      setFields,
    );

    if (value === null) {
      throw new Error("Primary adapter does not support incrementFieldAndGet");
    }

    try {
      const mirroredValue = await tryIncrementFieldAndGet(
        this.secondary,
        collection,
        id,
        field,
        amount,
        setFields,
      );
      if (mirroredValue === null) {
        await this.secondary.updateOne(collection, id, {
          $inc: { [field]: amount },
          ...(setFields && Object.keys(setFields).length > 0
            ? { $set: setFields }
            : {}),
        });
      }
    } catch (err) {
      console.error(
        `[dual-write] Secondary incrementFieldAndGet failed for ${collection}/${id}:`,
        err instanceof Error ? err.message : err,
      );
    }

    return value;
  }

  async deleteOne(collection: string, id: string): Promise<void> {
    await this.primary.deleteOne(collection, id);
    try {
      await this.secondary.deleteOne(collection, id);
    } catch (err) {
      console.error(
        `[dual-write] Secondary deleteOne failed for ${collection}/${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async deleteMany(collection: string, where: WhereClause[]): Promise<number> {
    const count = await this.primary.deleteMany(collection, where);
    try {
      await this.secondary.deleteMany(collection, where);
    } catch (err) {
      console.error(
        `[dual-write] Secondary deleteMany failed for ${collection}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return count;
  }

  async batchWrite(operations: BatchOperation[]): Promise<void> {
    await this.primary.batchWrite(operations);
    try {
      await this.secondary.batchWrite(operations);
    } catch (err) {
      console.error(
        "[dual-write] Secondary batchWrite failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  async close(): Promise<void> {
    await this.primary.close();
    await this.secondary.close();
  }
}
