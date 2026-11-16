import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import type { NotificationHistoryItem } from "@/lib/types";
import {
  fetchNotificationHistory,
  fetchUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/lib/notification-history";

interface UseNotificationHistoryOptions {
  readonly user: User | null;
  readonly enabled: boolean;
  readonly initialLoading?: boolean;
  readonly emitUnreadCountEvent?: boolean;
  readonly onUnreadCountChange?: (count: number) => void;
  readonly refreshUnreadCountFromServer?: boolean;
}

export function useNotificationHistory({
  user,
  enabled,
  initialLoading = false,
  emitUnreadCountEvent = false,
  onUnreadCountChange,
  refreshUnreadCountFromServer = false,
}: UseNotificationHistoryOptions) {
  const [requestContext, setRequestContext] = useState({ user, enabled });
  const [notifications, setNotifications] = useState<NotificationHistoryItem[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(
    initialLoading || (enabled && Boolean(user)),
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  if (requestContext.user !== user || requestContext.enabled !== enabled) {
    setRequestContext({ user, enabled });

    if (enabled && user) {
      setIsLoading(true);
      setError(null);
    }
  }

  const requestNotifications = useCallback(
    (offset = 0, append = false) => {
      if (!user) {
        return Promise.resolve();
      }

      return fetchNotificationHistory(user, offset)
        .then((data) => {
          if (append) {
            setNotifications((prev) => [...prev, ...(data.items || [])]);
          } else {
            setNotifications(data.items || []);
          }

          setHasMore(data.hasMore || false);
          setNextOffset(data.nextOffset);
        })
        .catch((fetchError) => {
          console.error("Error fetching notifications:", fetchError);
          setError("Неуспешно зареждане на известията");
          if (!append) {
            setNotifications([]);
          }
        })
        .finally(() => {
          setIsLoading(false);
          setIsLoadingMore(false);
        });
    },
    [user],
  );

  const fetchNotifications = useCallback(
    async (offset = 0, append = false) => {
      if (!user) {
        return;
      }

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      await requestNotifications(offset, append);
    },
    [user, requestNotifications],
  );

  const loadMore = useCallback(() => {
    if (nextOffset !== null && !isLoadingMore) {
      void fetchNotifications(nextOffset, true);
    }
  }, [nextOffset, isLoadingMore, fetchNotifications]);

  const updateUnreadCount = useCallback(
    async (localCount: number) => {
      if (!user) {
        return;
      }

      if (emitUnreadCountEvent && globalThis.window !== undefined) {
        globalThis.window.dispatchEvent(
          new CustomEvent("notifications:unread-count-changed", {
            detail: { count: localCount },
          }),
        );
      }

      if (!onUnreadCountChange) {
        return;
      }

      if (refreshUnreadCountFromServer) {
        try {
          const unreadCount = await fetchUnreadNotificationCount(user);
          onUnreadCountChange(unreadCount);
        } catch (countError) {
          console.error(
            "Error fetching unread notification count:",
            countError,
          );
        }
        return;
      }

      onUnreadCountChange(localCount);
    },
    [
      user,
      emitUnreadCountEvent,
      onUnreadCountChange,
      refreshUnreadCountFromServer,
    ],
  );

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!user) {
        return;
      }

      try {
        await markNotificationAsRead(user, notificationId);

        let unreadCount = 0;
        setNotifications((prev) => {
          const updated = prev.map((notification) =>
            notification.id === notificationId
              ? { ...notification, readAt: new Date().toISOString() }
              : notification,
          );
          unreadCount = updated.filter(
            (notification) => !notification.readAt,
          ).length;
          return updated;
        });

        await updateUnreadCount(unreadCount);
      } catch (markError) {
        console.error("Error marking notification as read:", markError);
      }
    },
    [user, updateUnreadCount],
  );

  const markAllRead = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      await markAllNotificationsAsRead(user);

      const now = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((notification) => ({ ...notification, readAt: now })),
      );

      await updateUnreadCount(0);
    } catch (markAllError) {
      console.error("Error marking all notifications as read:", markAllError);
    }
  }, [user, updateUnreadCount]);

  useEffect(() => {
    if (!enabled || !user) {
      return;
    }
    void requestNotifications();
  }, [enabled, user, requestNotifications]);

  return {
    notifications,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    markAsRead,
    markAllRead,
    refresh: fetchNotifications,
  };
}
