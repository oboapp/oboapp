import type { User } from "firebase/auth";
import { fetchWithAuth } from "@/lib/auth-fetch";
import type { NotificationHistoryItem } from "@/lib/types";

const NOTIFICATION_HISTORY_PAGE_SIZE = 20;

export interface NotificationHistoryPage {
  items: NotificationHistoryItem[];
  hasMore: boolean;
  nextOffset: number | null;
}

export async function fetchNotificationHistory(
  user: User,
  offset = 0,
): Promise<NotificationHistoryPage> {
  const url = `/api/notifications/history?limit=${NOTIFICATION_HISTORY_PAGE_SIZE}&offset=${offset}`;
  const response = await fetchWithAuth(user, url);

  if (!response.ok) {
    throw new Error("Failed to fetch notifications");
  }

  const data: {
    items?: NotificationHistoryItem[];
    hasMore?: boolean;
    nextOffset?: number | null;
  } = await response.json();

  return {
    items: data.items || [],
    hasMore: data.hasMore || false,
    nextOffset: typeof data.nextOffset === "number" ? data.nextOffset : null,
  };
}

export async function markNotificationAsRead(
  user: User,
  notificationId: string,
): Promise<void> {
  const response = await fetchWithAuth(user, "/api/notifications/mark-read", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notificationId }),
  });

  if (!response.ok) {
    throw new Error("Failed to mark as read");
  }
}

export async function markAllNotificationsAsRead(user: User): Promise<void> {
  const response = await fetchWithAuth(
    user,
    "/api/notifications/mark-all-read",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to mark all as read");
  }
}

export async function fetchUnreadNotificationCount(
  user: User,
): Promise<number> {
  const response = await fetchWithAuth(user, "/api/notifications/unread-count");

  if (!response.ok) {
    throw new Error("Failed to fetch unread count");
  }

  const data: { count?: number } = await response.json();
  return data.count || 0;
}

export function formatNotificationDateTime(notifiedAt: string): string {
  return new Date(notifiedAt).toLocaleDateString("bg-BG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
