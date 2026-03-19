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

  // Collect and validate all message IDs up front
  const messageIds = messages.map((msg) => {
    const messageId = msg._id as string;
    if (!messageId) {
      throw new Error(
        `Message is missing required _id field: ${JSON.stringify(msg)}`,
      );
    }
    return messageId;
  });

  // 1. Find and delete all eventMessage links
  const linksPerMessage = await Promise.all(
    messageIds.map((id) => db.eventMessages.findByMessageId(id)),
  );
  const allLinks = linksPerMessage.flat();

  for (const link of allLinks) {
    if (!link._id || !link.eventId) {
      throw new Error(
        `eventMessage link is missing required fields (_id or eventId): ${JSON.stringify(link)}`,
      );
    }
    affectedEventIds.add(link.eventId as string);
  }

  const linkResults = await Promise.allSettled(
    allLinks.map((link) => db.eventMessages.deleteOne(link._id as string)),
  );
  stats.eventMessagesDeleted = linkResults.filter(
    (r) => r.status === "fulfilled",
  ).length;

  // 2. Find and delete all notificationMatches
  const matchesPerMessage = await Promise.all(
    messageIds.map((id) =>
      db.notificationMatches.findMany({
        where: [{ field: "messageId", op: "==", value: id }],
      }),
    ),
  );
  const allMatches = matchesPerMessage.flat();

  for (const match of allMatches) {
    if (!match._id) {
      throw new Error(
        `notificationMatch is missing required _id field: ${JSON.stringify(match)}`,
      );
    }
  }

  const matchResults = await Promise.allSettled(
    allMatches.map((match) =>
      db.notificationMatches.deleteOne(match._id as string),
    ),
  );
  stats.notificationMatchesDeleted = matchResults.filter(
    (r) => r.status === "fulfilled",
  ).length;

  // 3. Delete the messages themselves
  const msgResults = await Promise.allSettled(
    messageIds.map((id) => db.messages.deleteOne(id)),
  );
  stats.messagesDeleted = msgResults.filter(
    (r) => r.status === "fulfilled",
  ).length;

  // 4. Delete orphaned events (events with zero remaining messages)
  const eventIds = Array.from(affectedEventIds);
  const remainingPerEvent = await Promise.all(
    eventIds.map((id) => db.eventMessages.findByEventId(id)),
  );

  const orphanEventIds = eventIds.filter(
    (_, i) => remainingPerEvent[i].length === 0,
  );
  const eventResults = await Promise.allSettled(
    orphanEventIds.map((id) => db.events.deleteOne(id)),
  );
  stats.orphanedEventsDeleted = eventResults.filter(
    (r) => r.status === "fulfilled",
  ).length;

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
