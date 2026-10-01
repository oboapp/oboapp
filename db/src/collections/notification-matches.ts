/**
 * Notification matches collection repository.
 */

import type { DbClient, FindManyOptions, WhereClause } from "../types";

/** Collection name constant */
export const NOTIFICATION_MATCHES_COLLECTION = "notificationMatches";

export class NotificationMatchesRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Record<string, unknown> | null> {
    return this.db.findOne(NOTIFICATION_MATCHES_COLLECTION, id);
  }

  async findMany(
    options?: FindManyOptions,
  ): Promise<Record<string, unknown>[]> {
    return this.db.findMany(NOTIFICATION_MATCHES_COLLECTION, options);
  }

  async insertOne(data: Record<string, unknown>): Promise<string> {
    return this.db.insertOne(NOTIFICATION_MATCHES_COLLECTION, data);
  }

  async updateOne(id: string, data: Record<string, unknown>): Promise<void> {
    return this.db.updateOne(NOTIFICATION_MATCHES_COLLECTION, id, data);
  }

  async deleteOne(id: string): Promise<void> {
    return this.db.deleteOne(NOTIFICATION_MATCHES_COLLECTION, id);
  }

  /** Find unnotified matches */
  async findUnnotified(limit: number): Promise<Record<string, unknown>[]> {
    return this.db.findMany(NOTIFICATION_MATCHES_COLLECTION, {
      where: [{ field: "notified", op: "==", value: false }],
      limit,
      select: [
        "userId",
        "messageId",
        "interestId",
        "matchedAt",
        "notified",
        "notifiedAt",
        "distance",
      ],
    });
  }

  /** Find notification history for a user */
  async findByUserId(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Record<string, unknown>[]> {
    return this.db.findMany(NOTIFICATION_MATCHES_COLLECTION, {
      where: [
        { field: "userId", op: "==", value: userId },
        { field: "notified", op: "==", value: true },
      ],
      orderBy: [{ field: "notifiedAt", direction: "desc" }],
      limit: options?.limit,
      offset: options?.offset,
    });
  }

  /**
   * Delete all matches for a user (used in user deletion cascade).
   */
  async deleteAllByUserId(userId: string): Promise<number> {
    return this.db.deleteMany(NOTIFICATION_MATCHES_COLLECTION, [
      { field: "userId", op: "==", value: userId },
    ]);
  }

  async count(where?: WhereClause[]): Promise<number> {
    return this.db.count(NOTIFICATION_MATCHES_COLLECTION, where);
  }
}
