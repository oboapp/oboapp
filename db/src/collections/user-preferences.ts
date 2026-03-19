/**
 * User preferences collection repository.
 *
 * Stores per-user settings such as notification filter preferences.
 * The document ID equals the user's `userId` — enforcing one document per user at the DB level.
 */

import type { DbClient, FindManyOptions } from "../types";

/** Collection name constant */
export const USER_PREFERENCES_COLLECTION = "userPreferences";

export class UserPreferencesRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Record<string, unknown> | null> {
    return this.db.findOne(USER_PREFERENCES_COLLECTION, id);
  }

  async findMany(
    options?: FindManyOptions,
  ): Promise<Record<string, unknown>[]> {
    return this.db.findMany(USER_PREFERENCES_COLLECTION, options);
  }

  async updateOne(id: string, data: Record<string, unknown>): Promise<void> {
    return this.db.updateOne(USER_PREFERENCES_COLLECTION, id, data);
  }

  async deleteOne(id: string): Promise<void> {
    return this.db.deleteOne(USER_PREFERENCES_COLLECTION, id);
  }

  /**
   * Find preferences for a user.
   * Since userId IS the document ID, this is a direct O(1) lookup.
   */
  async findByUserId(userId: string): Promise<Record<string, unknown> | null> {
    return this.db.findOne(USER_PREFERENCES_COLLECTION, userId);
  }

  /**
   * Find preferences for multiple users.
   * Uses parallel findOne lookups since userId IS the document ID.
   */
  async findByUserIds(
    userIds: string[],
  ): Promise<Record<string, unknown>[]> {
    if (userIds.length === 0) return [];
    const results = await Promise.all(
      userIds.map((id) => this.db.findOne(USER_PREFERENCES_COLLECTION, id)),
    );
    return results.filter((r): r is Record<string, unknown> => r !== null);
  }

  /**
   * Atomically create or update preferences for a user.
   * Uses userId as the document ID for uniqueness at the DB level.
   * Tries createOne first; on conflict (already exists) falls back to updateOne.
   * Returns the document ID (which equals userId).
   */
  async upsertByUserId(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const now = new Date();
    try {
      return await this.db.createOne(
        USER_PREFERENCES_COLLECTION,
        { ...data, createdAt: now, updatedAt: now },
        userId,
      );
    } catch (error) {
      // If document already exists, update instead; otherwise rethrow
      const isAlreadyExists =
        error instanceof Error &&
        (error.message.includes("ALREADY_EXISTS") ||
          error.message.includes("already exists") ||
          ("code" in error &&
            (error.code === 6 || error.code === "already-exists")));
      if (!isAlreadyExists) {
        throw error;
      }
      await this.db.updateOne(USER_PREFERENCES_COLLECTION, userId, {
        ...data,
        updatedAt: now,
      });
      return userId;
    }
  }
}
