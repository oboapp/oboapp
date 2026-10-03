/**
 * Database abstraction types for @oboapp/db
 *
 * Provides a unified interface over Firestore and MongoDB,
 * enabling dual-write and read-source switching.
 */

/** Supported database backends */
export type DbBackend = "firestore" | "mongodb";

/** Configuration for the database client */
export interface DbConfig {
  /** Which backend to read from */
  readSource: DbBackend;
  /** MongoDB connection URI (required when MongoDB is enabled) */
  mongoUri?: string;
  /** MongoDB database name */
  mongoDatabase?: string;
  /** Firestore instance (required when Firestore is enabled) */
  firestoreDb?: unknown;
}

/** Filter operators for queries */
export interface WhereClause {
  field: string;
  op:
    | "=="
    | "!="
    | "<"
    | "<="
    | ">"
    | ">="
    | "in"
    | "array-contains"
    | "array-contains-any"
    | "not-in";
  value: unknown;
}

/** Sort direction */
export interface OrderByClause {
  field: string;
  direction: "asc" | "desc";
}

/** Query options for findMany */
export interface FindManyOptions {
  where?: WhereClause[];
  orderBy?: OrderByClause[];
  limit?: number;
  offset?: number;
  select?: string[];
}

/** Opaque, in-memory cursor retaining the backend's native document ID. */
export interface DbPageCursor {
  backend: DbBackend;
  value: unknown;
}

export interface FindPageOptions {
  where?: WhereClause[];
  select?: string[];
  limit: number;
  after?: DbPageCursor;
}

export interface DbPage {
  documents: Record<string, unknown>[];
  nextCursor: DbPageCursor | null;
}

/** Batch write operation */
export interface BatchOperation {
  type: "set" | "update" | "delete";
  collection: string;
  id: string;
  data?: Record<string, unknown>;
  /** For set operations: merge behavior (like Firestore's { merge: true }) */
  merge?: boolean;
}

/** Update operators for atomic field updates */
export interface UpdateOperators {
  /** Fields to set */
  $set?: Record<string, unknown>;
  /** Add to array (unique — like Firestore's arrayUnion) */
  $addToSet?: Record<string, unknown>;
  /** Remove from array (like Firestore's arrayRemove) */
  $pull?: Record<string, unknown>;
  /** Increment numeric fields */
  $inc?: Record<string, number>;
}

/**
 * Core database client interface.
 *
 * Each method operates on a named collection and uses string document IDs.
 * The adapters (Firestore, MongoDB, dual-write) implement this interface.
 */
export interface DbClient {
  /** Read a bounded page ordered by native document ID ascending. */
  findPage(collection: string, options: FindPageOptions): Promise<DbPage>;
  /**
   * Get a single document by ID.
   * Returns null if not found.
   */
  findOne(
    collection: string,
    id: string,
  ): Promise<Record<string, unknown> | null>;

  /**
   * Query documents with optional filtering, sorting, and limiting.
   * Each returned document includes an `_id` field with the document ID.
   */
  findMany(
    collection: string,
    options?: FindManyOptions,
  ): Promise<Record<string, unknown>[]>;

  /**
   * Insert a new document. If `id` is provided, uses it as the document ID.
   * Otherwise, auto-generates an ID.
   * Returns the document ID.
   */
  insertOne(
    collection: string,
    data: Record<string, unknown>,
    id?: string,
  ): Promise<string>;

  /**
   * Atomically create a document — fails if it already exists.
   * Returns the document ID.
   * Throws if the document already exists.
   */
  createOne(
    collection: string,
    data: Record<string, unknown>,
    id: string,
  ): Promise<string>;

  /**
   * Update an existing document by ID.
   * `data` can be plain fields (shallow merge) or use UpdateOperators for atomic ops.
   */
  updateOne(
    collection: string,
    id: string,
    data: Record<string, unknown> | UpdateOperators,
  ): Promise<void>;

  /**
   * Delete a document by ID.
   */
  deleteOne(collection: string, id: string): Promise<void>;

  /**
   * Delete multiple documents matching a query.
   * Returns the number of deleted documents.
   */
  deleteMany(collection: string, where: WhereClause[]): Promise<number>;

  /**
   * Execute multiple write operations atomically (where supported).
   */
  batchWrite(operations: BatchOperation[]): Promise<void>;

  /**
   * Count documents matching a query.
   */
  count(collection: string, where?: WhereClause[]): Promise<number>;

  /**
   * Close the database connection (relevant for MongoDB).
   */
  close(): Promise<void>;
}

/**
 * Document with ID — returned from queries.
 * The `_id` field is always the string document ID.
 */
export type DocumentWithId = Record<string, unknown> & { _id: string };
