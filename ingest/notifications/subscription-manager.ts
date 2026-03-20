import type { OboDb } from "@oboapp/db";
import { NotificationSubscription } from "@/lib/types";
import { logger } from "@/lib/logger";
import { getString, getRecord } from "@/lib/record-fields";

function toDateOrString(value: unknown): Date | string {
  if (value instanceof Date) return value;
  if (typeof value === "string") return value;
  return new Date();
}

function toDeviceInfo(value: Record<string, unknown> | undefined): NotificationSubscription["deviceInfo"] {
  if (!value) return undefined;
  const result: { userAgent?: string; platform?: string } = {};
  if (typeof value.userAgent === "string") result.userAgent = value.userAgent;
  if (typeof value.platform === "string") result.platform = value.platform;
  return result;
}

/**
 * Get user subscriptions
 */
export async function getUserSubscriptions(
  db: OboDb,
  userId: string,
): Promise<NotificationSubscription[]> {
  const docs = await db.notificationSubscriptions.findByUserId(userId);

  return docs.map((data) => ({
    id: getString(data._id),
    userId: getString(data.userId),
    token: getString(data.token),
    endpoint: getString(data.endpoint),
    createdAt: toDateOrString(data.createdAt),
    updatedAt: toDateOrString(data.updatedAt),
    deviceInfo: toDeviceInfo(getRecord(data.deviceInfo)),
  }));
}

/**
 * Delete invalid subscription from database
 */
export async function deleteSubscription(
  db: OboDb,
  subscriptionId: string,
): Promise<void> {
  await db.notificationSubscriptions.deleteOne(subscriptionId);
  logger.info("Removed invalid subscription", { subscriptionId: subscriptionId.substring(0, 8) });
}
