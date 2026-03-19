/**
 * MongoDB adapter — implements DbClient using the official MongoDB driver.
 *
 * Stores native types (Date, objects) — no stringified JSON or FieldValue wrappers.
 */

import {
  MongoClient,
  Db,
  type Filter,
  type Sort,
  type Document,
  type OptionalUnlessRequiredId,
  MongoServerError,
} from "mongodb";
import type {
  DbClient,
  FindManyOptions,
  WhereClause,
  BatchOperation,
  UpdateOperators,
} from "./types";

/** Error code for duplicate key in MongoDB */
const DUPLICATE_KEY_ERROR = 11000;

function buildFilter(clauses?: WhereClause[]): Filter<Document> {
  if (!clauses || clauses.length === 0) return {};

  const filters: Filter<Document>[] = [];

  const addFilter = (filter: Filter<Document>) => {
    filters.push(filter);
  };

  for (const clause of clauses) {
    const field = clause.field === "_id" ? "_id" : clause.field;
    switch (clause.op) {
      case "==":
        addFilter({ [field]: clause.value });
        break;
      case "!=":
        addFilter({ [field]: { $ne: clause.value } });
        break;
      case "<":
        addFilter({ [field]: { $lt: clause.value } });
        break;
      case "<=":
        addFilter({ [field]: { $lte: clause.value } });
        break;
      case ">":
        addFilter({ [field]: { $gt: clause.value } });
        break;
      case ">=":
        addFilter({ [field]: { $gte: clause.value } });
        break;
      case "in":
        addFilter({ [field]: { $in: clause.value } });
        break;
      case "not-in":
        addFilter({ [field]: { $nin: clause.value } });
        break;
      case "array-contains":
        addFilter({ [field]: clause.value });
        break;
      case "array-contains-any":
        addFilter({ [field]: { $in: clause.value } });
        break;
    }
  }

  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0];
  const combined: Filter<Document> = { $and: filters };
  return combined;
}

function buildSort(
  orderBy?: { field: string; direction: "asc" | "desc" }[],
): Sort | undefined {
  if (!orderBy || orderBy.length === 0) return undefined;

  const sort: Record<string, 1 | -1> = {};
  for (const order of orderBy) {
    sort[order.field] = order.direction === "asc" ? 1 : -1;
  }
  return sort;
}

function isUpdateOperators(data: unknown): data is UpdateOperators {
  if (!data || typeof data !== "object") return false;
  const keys = Object.keys(data);
  return keys.some((k) => k.startsWith("$"));
}

/** Build a MongoDB _id filter from a string ID */
function idFilter(id: string): Filter<Document> {
  const base: Filter<Document> = {};
  return Object.assign(base, { _id: id });
}

/** Build a document with string _id for insert operations */
function withId(
  data: Record<string, unknown>,
  id: string,
): OptionalUnlessRequiredId<Document> {
  const doc: Document = { ...data, _id: id };
  return doc;
}

export class MongoAdapter implements DbClient {
  private client: MongoClient;
  private db: Db;

  constructor(client: MongoClient, database: string) {
    this.client = client;
    this.db = client.db(database);
  }

  /**
   * Create a MongoAdapter from a connection URI.
   * Connects to the server before returning.
   */
  static async connect(uri: string, database: string): Promise<MongoAdapter> {
    const client = new MongoClient(uri);
    await client.connect();
    return new MongoAdapter(client, database);
  }

  /** Expose the raw Db instance for advanced operations (e.g., index creation) */
  getDb(): Db {
    return this.db;
  }

  async findOne(
    collection: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const doc = await this.db
      .collection(collection)
      .findOne(idFilter(id));
    if (!doc) return null;
    const result: Record<string, unknown> = { ...doc, _id: String(doc._id) };
    return result;
  }

  async findMany(
    collection: string,
    options?: FindManyOptions,
  ): Promise<Record<string, unknown>[]> {
    const filter = buildFilter(options?.where);
    const sort = buildSort(options?.orderBy);

    let cursor = this.db.collection(collection).find(filter);

    if (sort) {
      cursor = cursor.sort(sort);
    }

    if (options?.offset) {
      cursor = cursor.skip(options.offset);
    }

    if (options?.limit) {
      cursor = cursor.limit(options.limit);
    }

    if (options?.select && options.select.length > 0) {
      const projection: Record<string, 1> = {};
      for (const field of options.select) {
        projection[field] = 1;
      }
      cursor = cursor.project(projection);
    }

    const docs = await cursor.toArray();
    return docs.map((doc) => ({ ...doc, _id: String(doc._id) }));
  }

  async insertOne(
    collection: string,
    data: Record<string, unknown>,
    id?: string,
  ): Promise<string> {
    const doc: OptionalUnlessRequiredId<Document> = id
      ? withId(data, id)
      : { ...data };
    const result = await this.db
      .collection(collection)
      .insertOne(doc);
    return String(result.insertedId);
  }

  async createOne(
    collection: string,
    data: Record<string, unknown>,
    id: string,
  ): Promise<string> {
    try {
      const doc = withId(data, id);
      await this.db
        .collection(collection)
        .insertOne(doc);
      return id;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === DUPLICATE_KEY_ERROR) {
        const alreadyExistsError = Object.assign(
          new Error(`Document already exists: ${collection}/${id}`),
          { code: "already-exists" },
        );
        throw alreadyExistsError;
      }
      throw err;
    }
  }

  async updateOne(
    collection: string,
    id: string,
    data: Record<string, unknown> | UpdateOperators,
  ): Promise<void> {
    const filter = idFilter(id);

    if (isUpdateOperators(data)) {
      const update: Record<string, unknown> = {};
      if (data.$set) update.$set = data.$set;
      if (data.$addToSet) {
        const addToSet: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data.$addToSet)) {
          addToSet[key] = Array.isArray(value) ? { $each: value } : value;
        }
        update.$addToSet = addToSet;
      }
      if (data.$pull) update.$pull = data.$pull;
      if (data.$inc) update.$inc = data.$inc;

      await this.db.collection(collection).updateOne(filter, update);
    } else {
      await this.db.collection(collection).updateOne(filter, { $set: data });
    }
  }

  async deleteOne(collection: string, id: string): Promise<void> {
    await this.db
      .collection(collection)
      .deleteOne(idFilter(id));
  }

  async deleteMany(collection: string, where: WhereClause[]): Promise<number> {
    const filter = buildFilter(where);
    const result = await this.db.collection(collection).deleteMany(filter);
    return result.deletedCount;
  }

  async batchWrite(operations: BatchOperation[]): Promise<void> {
    // Group operations by collection for efficient bulk writes
    const byCollection = new Map<
      string,
      {
        type: string;
        id: string;
        data?: Record<string, unknown>;
        merge?: boolean;
      }[]
    >();

    for (const op of operations) {
      const ops = byCollection.get(op.collection) ?? [];
      ops.push(op);
      byCollection.set(op.collection, ops);
    }

    for (const [collectionName, ops] of byCollection) {
      const col = this.db.collection(collectionName);
      const bulkOps = ops.map((op) => {
        const filter = idFilter(op.id);
        switch (op.type) {
          case "set":
            if (op.merge) {
              return {
                updateOne: {
                  filter,
                  update: { $set: { ...op.data, _id: op.id } },
                  upsert: true,
                },
              };
            }
            return {
              replaceOne: {
                filter,
                replacement: { ...(op.data ?? {}), _id: op.id },
                upsert: true,
              },
            };
          case "update":
            return {
              updateOne: {
                filter,
                update: { $set: op.data ?? {} },
              },
            };
          case "delete":
            return { deleteOne: { filter } };
          default:
            throw new Error(`Unknown batch operation type: ${op.type}`);
        }
      });

      if (bulkOps.length > 0) {
        await col.bulkWrite(bulkOps);
      }
    }
  }

  async count(collection: string, where?: WhereClause[]): Promise<number> {
    const filter = buildFilter(where);
    return this.db.collection(collection).countDocuments(filter);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
