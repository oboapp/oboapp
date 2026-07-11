import type { OboDb } from "@oboapp/db";
import type { Messaging } from "firebase-admin/messaging";
import type { Message, NotificationMatch } from "@/lib/types";
import {
  getOptionalBoolean,
  getOptionalString,
  getString,
} from "@/lib/record-fields";
import { getUserSubscriptions } from "./subscription-manager";
import {
  buildNotificationPayload,
  sendToUserDevices,
} from "./notification-sender";

export interface TestNotificationResult {
  readonly status: "message-not-found" | "dry-run" | "sent";
  readonly deviceCount: number;
  readonly sourceIcon?: string;
  readonly successCount?: number;
}

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

export function createTestNotificationMatch(
  userId: string,
  messageId: string,
): NotificationMatch {
  return {
    userId,
    messageId,
    interestId: "test-notification",
    matchedAt: new Date(),
    notified: false,
  };
}

export function toNotificationMessage(
  messageId: string,
  data: Record<string, unknown>,
): Message | null {
  const locality = getOptionalString(data.locality);
  if (!locality) return null;

  return {
    id: messageId,
    text:
      getString(data.summary) ||
      getString(data.plainText) ||
      getString(data.text),
    aiProcessed: getOptionalBoolean(data.aiProcessed) === true,
    locality,
    createdAt: toISOString(data.createdAt),
    source: getOptionalString(data.source),
  };
}

export async function sendTestNotification(
  db: OboDb,
  messaging: Messaging,
  userId: string,
  messageId: string,
  execute: boolean,
): Promise<TestNotificationResult> {
  const messageData = await db.messages.findById(messageId);
  if (!messageData) {
    return { status: "message-not-found", deviceCount: 0 };
  }

  const message = toNotificationMessage(messageId, messageData);
  if (!message) {
    throw new Error(`Message "${messageId}" is missing its locality.`);
  }

  const match = createTestNotificationMatch(userId, messageId);
  const payload = buildNotificationPayload(message, match);

  if (!execute) {
    const subscriptions = await getUserSubscriptions(db, userId);
    return {
      status: "dry-run",
      deviceCount: subscriptions.length,
      sourceIcon: payload.data.senderIcon,
    };
  }

  const { successCount, notifications } = await sendToUserDevices(
    db,
    messaging,
    userId,
    message,
    match,
  );

  return {
    status: "sent",
    deviceCount: notifications.length,
    sourceIcon: payload.data.senderIcon,
    successCount,
  };
}
