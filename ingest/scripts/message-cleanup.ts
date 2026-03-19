/**
 * Shared cleanup logic for deleting messages and their related records.
 *
 * Related records: eventMessages links, orphaned events, notificationMatches.
 */

import type { OboDb } from "@oboapp/db";

export interface CleanupStats {
  messagesDeleted: number;
  eventMessagesDeleted: number;
  orphanedEventsDeleted: number;
  notificationMatchesDeleted: number;
}

/**
 * Delete messages and all related records (eventMessages, orphaned events, notificationMatches).
 */
export async function deleteMessagesWithRelations(
  db: OboDb,
  messages: Record<string, unknown>[],
): Promise<CleanupStats> {
  const stats: CleanupStats = {
    messagesDeleted: 0,
    eventMessagesDeleted: 0,
    orphanedEventsDeleted: 0,
    notificationMatchesDeleted: 0,
  };

  // Collect affected event IDs so we can check for orphans after all links are removed.
  // This avoids premature deletion when multiple sibling messages share the same event.
  const affectedEventIds = new Set<string>();

  for (const msg of messages) {
    const messageId = msg._id as string;

    // 1. Delete eventMessage links
    const links = await db.eventMessages.findByMessageId(messageId);
    for (const link of links) {
      affectedEventIds.add(link.eventId as string);
      await db.eventMessages.deleteOne(link._id as string);
      stats.eventMessagesDeleted++;
    }

    // 2. Delete notificationMatches
    const matches = await db.notificationMatches.findMany({
      where: [{ field: "messageId", op: "==", value: messageId }],
    });
    for (const match of matches) {
      await db.notificationMatches.deleteOne(match._id as string);
      stats.notificationMatchesDeleted++;
    }

    // 3. Delete the message itself
    await db.messages.deleteOne(messageId);
    stats.messagesDeleted++;
  }

  // 4. Delete orphaned events (events with zero remaining messages)
  for (const eventId of affectedEventIds) {
    const remaining = await db.eventMessages.findByEventId(eventId);
    if (remaining.length === 0) {
      await db.events.deleteOne(eventId);
      stats.orphanedEventsDeleted++;
    }
  }

  return stats;
}

/**
 * Log cleanup stats to console.
 */
export function logCleanupStats(stats: CleanupStats, indent = ""): void {
  console.log(
    `${indent}Deleted: ${stats.messagesDeleted} message(s), ${stats.eventMessagesDeleted} event link(s), ${stats.orphanedEventsDeleted} orphaned event(s), ${stats.notificationMatchesDeleted} notification match(es)`,
  );
}
