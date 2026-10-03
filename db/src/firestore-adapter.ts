/**
 * Firestore adapter — implements DbClient using Firebase Admin SDK.
 *
 * Applies transforms on read/write to convert between application-level native
 * types and Firestore's storage format (JSON strings, Timestamps, etc.).
 */

import type {
  DbClient,
  FindManyOptions,
  FindPageOptions,
  DbPage,
  WhereClause,
  BatchOperation,
  UpdateOperators,
} from "./types";
import {
  transformForFirestoreWrite,
  transformFromFirestoreRead,
} from "./firestore-transforms";

type Firestore = FirebaseFirestore.Firestore;
type Query = FirebaseFirestore.Query;

/** Map our operator strings to Firestore WhereFilterOp */
const OP_MAP: Record<WhereClause["op"], FirebaseFirestore.WhereFilterOp> = {
  "==": "==",
  "!=": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  in: "in",
  "array-contains": "array-contains",
  "array-contains-any": "array-contains-any",
  "not-in": "not-in",
};

function isUpdateOperators(data: unknown): data is UpdateOperators {
  if (!data || typeof data !== "object") return false;
  const keys = Object.keys(data);
  return keys.some((k) => k.startsWith("$"));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function assignArrayOperatorUpdates(
  updates: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
  mapValue: (value: unknown[]) => unknown,
): void {
  if (!payload) {
    return;
  }

  for (const [key, value] of Object.entries(payload)) {
    updates[key] = mapValue(asArray(value));
  }
}

function assignIncrementUpdates(
  updates: Record<string, unknown>,
  payload: Record<string, number> | undefined,
  increment: (n: number) => unknown,
): void {
  if (!payload) {
    return;
  }

  for (const [key, value] of Object.entries(payload)) {
    updates[key] = increment(value);
  }
}

export class FirestoreAdapter implements DbClient {
  async findPage(
    collection: string,
    options: FindPageOptions,
  ): Promise<DbPage> {
    const after = options.after;
    if (
      after &&
      (after.backend !== "firestore" || typeof after.value !== "string")
    ) {
      throw new Error(
        "Firestore pagination requires a Firestore string cursor",
      );
    }
    const documents = await this.findMany(collection, {
      where: [
        ...(options.where ?? []),
        ...(after
          ? [{ field: "_id", op: ">" as const, value: after.value }]
          : []),
      ],
      select: options.select,
      limit: options.limit,
      orderBy: [{ field: "_id", direction: "asc" }],
    });
    const last = documents.at(-1);
    return {
      documents,
      nextCursor: last ? { backend: "firestore", value: last._id } : null,
    };
  }
  constructor(private readonly db: Firestore) {}

  async findOne(
    collection: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const doc = await this.db.collection(collection).doc(id).get();
    if (!doc.exists) return null;
    const raw: Record<string, unknown> = { _id: doc.id, ...doc.data() };
    return transformFromFirestoreRead(collection, raw);
  }

  async findMany(
    collection: string,
    options?: FindManyOptions,
  ): Promise<Record<string, unknown>[]> {
    let query: Query = this.db.collection(collection);

    if (options?.where) {
      for (const clause of options.where) {
        // Firestore stores document IDs separately from field data.
        // Filtering by "_id" requires FieldPath.documentId() — a literal
        // where("_id", ...) query will always return zero results.
        // Only import FieldPath when actually needed to avoid async overhead
        // on the common path.
        if (clause.field === "_id") {
          const { FieldPath } = await import("firebase-admin/firestore");
          query = query.where(
            FieldPath.documentId(),
            OP_MAP[clause.op],
            clause.value,
          );
        } else {
          query = query.where(clause.field, OP_MAP[clause.op], clause.value);
        }
      }
    }

    if (options?.orderBy) {
      for (const order of options.orderBy) {
        if (order.field === "_id") {
          const { FieldPath } = await import("firebase-admin/firestore");
          query = query.orderBy(FieldPath.documentId(), order.direction);
        } else {
          query = query.orderBy(order.field, order.direction);
        }
      }
    }

    if (options?.offset) {
      query = query.offset(options.offset);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.select) {
      query = query.select(...options.select);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) =>
      transformFromFirestoreRead(collection, { _id: doc.id, ...doc.data() }),
    );
  }

  async insertOne(
    collection: string,
    data: Record<string, unknown>,
    id?: string,
  ): Promise<string> {
    const transformed = transformForFirestoreWrite(collection, data);
    if (id) {
      await this.db.collection(collection).doc(id).set(transformed);
      return id;
    }
    const ref = await this.db.collection(collection).add(transformed);
    return ref.id;
  }

  async createOne(
    collection: string,
    data: Record<string, unknown>,
    id: string,
  ): Promise<string> {
    const transformed = transformForFirestoreWrite(collection, data);
    await this.db.collection(collection).doc(id).create(transformed);
    return id;
  }

  async updateOne(
    collection: string,
    id: string,
    data: Record<string, unknown> | UpdateOperators,
  ): Promise<void> {
    const docRef = this.db.collection(collection).doc(id);

    if (isUpdateOperators(data)) {
      const { FieldValue } = await import("firebase-admin/firestore");
      const updates: Record<string, unknown> = {};

      if (data.$set) {
        const transformed = transformForFirestoreWrite(collection, data.$set);
        Object.assign(updates, transformed);
      }

      assignArrayOperatorUpdates(updates, data.$addToSet, (value) =>
        FieldValue.arrayUnion(...value),
      );
      assignArrayOperatorUpdates(updates, data.$pull, (value) =>
        FieldValue.arrayRemove(...value),
      );
      assignIncrementUpdates(updates, data.$inc, (value) =>
        FieldValue.increment(value),
      );

      await docRef.update(updates);
    } else {
      const transformed = transformForFirestoreWrite(collection, data);
      await docRef.update(transformed);
    }
  }

  async incrementFieldAndGet(
    collection: string,
    id: string,
    field: string,
    amount: number,
    setFields?: Record<string, unknown>,
  ): Promise<number> {
    const docRef = this.db.collection(collection).doc(id);

    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(docRef);
      if (!snapshot.exists) {
        throw new Error(
          `Cannot increment missing document: ${collection}/${id}`,
        );
      }

      const data = snapshot.data() ?? {};
      const current = data[field];
      if (typeof current !== "number") {
        throw new TypeError(
          `Atomic increment requires numeric field ${collection}/${id}.${field}`,
        );
      }

      const next = current + amount;
      const transformedSetFields = setFields
        ? transformForFirestoreWrite(collection, setFields)
        : undefined;

      tx.update(docRef, {
        [field]: next,
        ...transformedSetFields,
      });

      return next;
    });
  }

  async deleteOne(collection: string, id: string): Promise<void> {
    await this.db.collection(collection).doc(id).delete();
  }

  async deleteMany(collection: string, where: WhereClause[]): Promise<number> {
    let query: Query = this.db.collection(collection);
    for (const clause of where) {
      query = query.where(clause.field, OP_MAP[clause.op], clause.value);
    }

    const snapshot = await query.get();
    if (snapshot.empty) return 0;

    const BATCH_SIZE = 500;
    const docs = snapshot.docs;
    let deleted = 0;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = this.db.batch();
      const chunk = docs.slice(i, i + BATCH_SIZE);
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      deleted += chunk.length;
    }

    return deleted;
  }

  async batchWrite(operations: BatchOperation[]): Promise<void> {
    const BATCH_SIZE = 500;

    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const batch = this.db.batch();
      const chunk = operations.slice(i, i + BATCH_SIZE);

      for (const op of chunk) {
        const docRef = this.db.collection(op.collection).doc(op.id);
        switch (op.type) {
          case "set": {
            const transformed = transformForFirestoreWrite(
              op.collection,
              op.data ?? {},
            );
            if (op.merge) {
              batch.set(docRef, transformed, { merge: true });
            } else {
              batch.set(docRef, transformed);
            }
            break;
          }
          case "update": {
            const transformed = transformForFirestoreWrite(
              op.collection,
              op.data ?? {},
            );
            batch.update(docRef, transformed);
            break;
          }
          case "delete":
            batch.delete(docRef);
            break;
        }
      }

      await batch.commit();
    }
  }

  async count(collection: string, where?: WhereClause[]): Promise<number> {
    let query: Query = this.db.collection(collection);
    if (where) {
      for (const clause of where) {
        query = query.where(clause.field, OP_MAP[clause.op], clause.value);
      }
    }
    const snapshot = await query.count().get();
    return snapshot.data().count;
  }

  async close(): Promise<void> {
    // Firestore doesn't need explicit close in Admin SDK
  }
}
