#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import type { OboDb } from "@oboapp/db";
import type { Messaging } from "firebase-admin/messaging";
import { Message, NotificationMatch } from "@/lib/types";
import {
  getString,
  isFeatureCollection,
} from "@/lib/record-fields";
import {
  getUnprocessedMessages,
  markMessagesAsNotified,
} from "./message-fetcher";
import { getAllInterests } from "./interest-fetcher";
import {
  matchMessagesWithInterests,
  deduplicateMatches,
  storeNotificationMatches,
  getUnnotifiedMatches,
} from "./match-processor";
import type { UserNotificationFilters } from "./match-processor";
import {
  sendToUserDevices,
  updateMatchWithResults,
  markMatchesAsNotified,
} from "./notification-sender";
import { logger } from "@/lib/logger";

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Send notifications for matches
 */
async function sendNotifications(
  db: OboDb,
  messaging: Messaging,
  matches: NotificationMatch[],
): Promise<void> {
  logger.info("Sending notifications");

  let successCount = 0;
  let errorCount = 0;

  // Group matches by userId-messageId to send only one notification per user per message
  const notificationMap = new Map<string, NotificationMatch>();
  for (const match of matches) {
    const key = `${match.userId}-${match.messageId}`;
    const existing = notificationMap.get(key);
    // Keep the match with the smallest distance
    if (
      !existing ||
      (match.distance &&
        (!existing.distance || match.distance < existing.distance))
    ) {
      notificationMap.set(key, match);
    }
  }

  const uniqueMatches = Array.from(notificationMap.values());
  logger.info("Sending unique notifications", {
    unique: uniqueMatches.length,
    total: matches.length,
  });

  // Track which matches were processed to mark them all as notified
  const allMatchIds = matches
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  for (const match of uniqueMatches) {
    if (!match.id) {
      continue;
    }

    // Get message details
    const messageData = await db.messages.findById(match.messageId);
    if (!messageData) {
      logger.warn("Message not found for notification", {
        messageId: match.messageId,
      });
      continue;
    }

    // Validate required locality field
    if (!messageData?.locality) {
      console.error(
        `Message ${match.messageId} missing required locality field`,
      );
      continue;
    }

    // plainText is set by AI pipeline (Filter & Split stage).
    // For precomputed-GeoJSON crawlers, text is already plain.
    const message: Message = {
      id: match.messageId,
      text:
        getString(messageData.plainText) || getString(messageData.text),
      locality: getString(messageData.locality),
      geoJson: isFeatureCollection(messageData.geoJson) ? messageData.geoJson : undefined,
      createdAt: toISOString(messageData.createdAt),
    };

    // Send to all user devices
    const { successCount: deviceSuccessCount, notifications } =
      await sendToUserDevices(db, messaging, match.userId, message, match);

    if (deviceSuccessCount > 0) {
      successCount++;
      logger.info("Notification sent", {
        userId: match.userId.substring(0, 8),
        devicesSuccess: deviceSuccessCount,
        devicesTotal: notifications.length,
        messageId: match.messageId.substring(0, 8),
      });
    } else {
      errorCount++;
      logger.warn("Failed to send to any device", {
        userId: match.userId.substring(0, 8),
        messageId: match.messageId.substring(0, 8),
      });
    }

    if (messageData) {
      await updateMatchWithResults(db, match.id, messageData, notifications);
    }
  }

  // Mark all related matches as notified
  await markMatchesAsNotified(db, allMatchIds);

  logger.info("Notification sending complete", { successCount, errorCount });
}

/**
 * Initialize database and Firebase services
 */
async function initServices(): Promise<{
  db: OboDb;
  messaging: Messaging;
}> {
  const { getDb } = await import("@/lib/db");
  const firebaseAdmin = await import("@/lib/firebase-admin");
  const { getMessaging } = await import("firebase-admin/messaging");

  return {
    db: await getDb(),
    messaging: getMessaging(firebaseAdmin.adminApp),
  };
}

/**
 * Main function
 */
export async function main(): Promise<void> {
  logger.info("Starting notification matching and sending");

  const { db, messaging } = await initServices();

  // Step 1: Get unprocessed messages (messages without notificationsSent flag)
  const unprocessedMessages = await getUnprocessedMessages(db);

  if (unprocessedMessages.length === 0) {
    logger.info("No new messages to process");
    return;
  }

  // Step 2: Get all user interests
  const interests = await getAllInterests(db);

  if (interests.length === 0) {
    logger.info("No user interests configured");
    // Still mark messages as processed so we don't reprocess them
    const messageIds = unprocessedMessages
      .map((m) => m.id)
      .filter((id): id is string => !!id);
    await markMessagesAsNotified(db, messageIds);
    return;
  }

  // Step 3: Load user notification filter preferences (batch query to avoid N+1)
  const uniqueUserIds = [...new Set(interests.map((i) => i.userId))];
  const userFiltersMap = new Map<string, UserNotificationFilters>();

  const allPrefs = await db.userPreferences.findByUserIds(uniqueUserIds);
  for (const prefs of allPrefs) {
    const userId = getString(prefs._id);
    const rawCats = prefs.notificationCategories;
    const cats = Array.isArray(rawCats)
      ? rawCats.filter((v): v is string => typeof v === "string")
      : [];
    const rawSrcs = prefs.notificationSources;
    const srcs = Array.isArray(rawSrcs)
      ? rawSrcs.filter((v): v is string => typeof v === "string")
      : [];
    // Only add to map if user actually has active filters
    if (cats.length > 0 || srcs.length > 0) {
      userFiltersMap.set(userId, {
        notificationCategories: new Set(cats),
        notificationSources: new Set(srcs),
      });
    }
  }

  if (userFiltersMap.size > 0) {
    logger.info("Loaded user notification filters", {
      usersWithFilters: userFiltersMap.size,
      totalUsers: uniqueUserIds.length,
    });
  }

  // Step 4: Match messages with interests (applying user filters)
  const matches = await matchMessagesWithInterests(
    unprocessedMessages,
    interests,
    userFiltersMap,
  );

  if (matches.length === 0) {
    logger.info("No matches found");
    // Still mark messages as processed
    const messageIds = unprocessedMessages
      .map((m) => m.id)
      .filter((id): id is string => !!id);
    await markMessagesAsNotified(db, messageIds);
    return;
  }

  // Step 5: Deduplicate matches
  const dedupedMatches = deduplicateMatches(matches);

  // Step 6: Store matches in database
  await storeNotificationMatches(db, dedupedMatches);

  // Step 7: Get all unnotified matches (including ones we just stored)
  const unnotifiedMatches = await getUnnotifiedMatches(db);

  if (unnotifiedMatches.length === 0) {
    logger.info("No unnotified matches to send");
    // Mark messages as processed
    const messageIds = unprocessedMessages
      .map((m) => m.id)
      .filter((id): id is string => !!id);
    await markMessagesAsNotified(db, messageIds);
    return;
  }

  // Step 8: Send notifications
  await sendNotifications(db, messaging, unnotifiedMatches);

  // Step 9: Mark messages as having notifications sent
  const messageIds = unprocessedMessages
    .map((m) => m.id)
    .filter((id): id is string => !!id);
  await markMessagesAsNotified(db, messageIds);

  logger.info("Notification processing complete");
}

// Run the script only when executed directly
if (require.main === module) {
  void (async () => {
    try {
      await main();
    } catch (error) {
      logger.error("Fatal error in notification processing", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  })();
}
