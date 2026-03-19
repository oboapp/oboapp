/**
 * API clients collection repository.
 * Stores registered external API clients and their keys.
 * The document ID equals the user's `userId` — enforcing one client per user at the DB level.
 */

import type { DbClient, WhereClause } from "../types";

/** Collection name constant */
export const API_CLIENTS_COLLECTION = "apiClients";

export class ApiClientsRepository {
  constructor(private readonly db: DbClient) {}

  /** Find the API client for a user. Since userId IS the document ID, this is a direct lookup. */
  async findByUserId(userId: string): Promise<Record<string, unknown> | null> {
    return this.db.findOne(API_CLIENTS_COLLECTION, userId);
  }

  /** Look up an API client by its key value (for per-request validation). */
  async findByApiKey(apiKey: string): Promise<Record<string, unknown> | null> {
    const results = await this.db.findMany(API_CLIENTS_COLLECTION, {
      where: [{ field: "apiKey", op: "==", value: apiKey }],
      limit: 1,
    });
    return results[0] ?? null;
  }

  /**
   * Atomically create an API client for a user.
   * Uses the userId as the document ID. Throws if the user already has a client.
   */
  async createForUser(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    return this.db.createOne(API_CLIENTS_COLLECTION, data, userId);
  }

  async deleteOne(id: string): Promise<void> {
    return this.db.deleteOne(API_CLIENTS_COLLECTION, id);
  }

  /**
   * Delete the API client for a user (used in user deletion cascade).
   * Since userId IS the document ID, this is a direct deleteOne.
   */
  async deleteByUserId(userId: string): Promise<number> {
    try {
      await this.db.deleteOne(API_CLIENTS_COLLECTION, userId);
      return 1;
    } catch (error) {
      // If the document simply doesn't exist, treat as success
      const notFound =
        error instanceof Error &&
        (error.message.includes("NOT_FOUND") ||
          error.message.includes("not found") ||
          ("code" in error && error.code === 5));
      if (!notFound) {
        console.error("deleteByUserId: unexpected error deleting API client", error);
      }
      return 0;
    }
  }

  async count(where?: WhereClause[]): Promise<number> {
    return this.db.count(API_CLIENTS_COLLECTION, where);
  }
}
