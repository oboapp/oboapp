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
  const rejectedLinks = linkResults.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  stats.eventMessagesDeleted = allLinks.length - rejectedLinks.length;
  if (rejectedLinks.length > 0) {
    throw new Error(
      `Failed to delete ${rejectedLinks.length} eventMessage(s): ${rejectedLinks.map((r) => r.reason).join("; ")}`,
    );
  }

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
  const rejectedMatches = matchResults.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  stats.notificationMatchesDeleted = allMatches.length - rejectedMatches.length;
  if (rejectedMatches.length > 0) {
    throw new Error(
      `Failed to delete ${rejectedMatches.length} notificationMatch(es): ${rejectedMatches.map((r) => r.reason).join("; ")}`,
    );
  }

  // 3. Delete the messages themselves
  const msgResults = await Promise.allSettled(
    messageIds.map((id) => db.messages.deleteOne(id)),
  );
  const rejectedMsgs = msgResults.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  stats.messagesDeleted = messageIds.length - rejectedMsgs.length;
  if (rejectedMsgs.length > 0) {
    throw new Error(
      `Failed to delete ${rejectedMsgs.length} message(s): ${rejectedMsgs.map((r) => r.reason).join("; ")}`,
    );
  }

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
  const rejectedEvents = eventResults.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  stats.orphanedEventsDeleted = orphanEventIds.length - rejectedEvents.length;
  if (rejectedEvents.length > 0) {
    throw new Error(
      `Failed to delete ${rejectedEvents.length} orphaned event(s): ${rejectedEvents.map((r) => r.reason).join("; ")}`,
    );
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
