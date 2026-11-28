/**
 * Messages collection repository.
 *
 * Wraps DbClient with message-specific types and query helpers.
 * MongoDB stores native types — no JSON.stringify for geoJson/addresses.
 */

import type {
  DbClient,
  FindManyOptions,
  UpdateOperators,
  WhereClause,
} from "../types";

/** Collection name constant */
export const MESSAGES_COLLECTION = "messages";
const MAX_IDS_PER_QUERY = 30;

export class MessagesRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Record<string, unknown> | null> {
    return this.db.findOne(MESSAGES_COLLECTION, id);
  }

  /** Fetch each requested message once, in batches supported by both databases. */
  async findByIds(ids: readonly string[]): Promise<Record<string, unknown>[]> {
    return this.findByFieldValues("_id", [...new Set(ids)]);
  }

  async findMany(options?: FindManyOptions): Promise<Record<string, unknown>[]> {
    return this.db.findMany(MESSAGES_COLLECTION, options);
  }

  /**
   * Create a new message with a specific ID.
   * Uses atomic create — fails if the ID already exists.
   */
  async createOne(id: string, data: Record<string, unknown>): Promise<string> {
    return this.db.createOne(MESSAGES_COLLECTION, data, id);
  }

  async insertOne(data: Record<string, unknown>, id?: string): Promise<string> {
    return this.db.insertOne(MESSAGES_COLLECTION, data, id);
  }

  async updateOne(
    id: string,
    data: Record<string, unknown> | UpdateOperators,
  ): Promise<void> {
    return this.db.updateOne(MESSAGES_COLLECTION, id, data);
  }

  async deleteOne(id: string): Promise<void> {
    return this.db.deleteOne(MESSAGES_COLLECTION, id);
  }

  async count(where?: WhereClause[]): Promise<number> {
    return this.db.count(MESSAGES_COLLECTION, where);
  }

  /**
   * Find messages by source document IDs (for dedup checking).
   * Batches queries to avoid exceeding 'in' operator limits.
   */
  async findBySourceDocumentIds(
    sourceDocumentIds: string[],
    selectFields?: string[],
  ): Promise<Record<string, unknown>[]> {
    return this.findByFieldValues(
      "sourceDocumentId",
      sourceDocumentIds,
      selectFields,
    );
  }

  private async findByFieldValues(
    field: "_id" | "sourceDocumentId",
    values: readonly string[],
    selectFields?: string[],
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];

    for (let i = 0; i < values.length; i += MAX_IDS_PER_QUERY) {
      const batch = values.slice(i, i + MAX_IDS_PER_QUERY);
      const docs = await this.db.findMany(MESSAGES_COLLECTION, {
        where: [{ field, op: "in", value: batch }],
        select: selectFields,
      });
      results.push(...docs);
    }

    return results;
  }
}
