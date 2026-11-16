import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationHistoryPage } from "@/lib/notification-history";
import type { NotificationHistoryItem } from "@/lib/types";
import { useNotificationHistory } from "./useNotificationHistory";

const {
  fetchHistoryMock,
  fetchUnreadCountMock,
  markAllReadMock,
  markReadMock,
} = vi.hoisted(() => ({
  fetchHistoryMock: vi.fn(),
  fetchUnreadCountMock: vi.fn(),
  markAllReadMock: vi.fn(),
  markReadMock: vi.fn(),
}));

vi.mock("@/lib/notification-history", () => ({
  fetchNotificationHistory: fetchHistoryMock,
  fetchUnreadNotificationCount: fetchUnreadCountMock,
  markAllNotificationsAsRead: markAllReadMock,
  markNotificationAsRead: markReadMock,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createNotification(id: string): NotificationHistoryItem {
  return {
    id,
    messageId: `message-${id}`,
    messageSnapshot: {
      text: "Тестово известие",
      createdAt: "2026-07-10T09:00:00.000Z",
      source: "municipality-sofia",
      sourceUrl: "https://www.sofia.bg",
    },
    notifiedAt: "2026-07-10T10:00:00.000Z",
    interestId: "interest-1",
    successfulDevicesCount: 1,
    distance: 25,
  };
}

describe("useNotificationHistory", () => {
  const user = { uid: "user-1" } as User;
  const consoleErrorMock = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    markReadMock.mockResolvedValue(undefined);
    markAllReadMock.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(consoleErrorMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts loading as soon as history is enabled without duplicate requests", async () => {
    const page = createDeferred<NotificationHistoryPage>();
    const notification = createNotification("notification-1");
    fetchHistoryMock.mockReturnValue(page.promise);

    const { result, rerender } = renderHook(
      ({ enabled }) => useNotificationHistory({ user, enabled }),
      { initialProps: { enabled: false } },
    );

    expect(result.current.isLoading).toBe(false);
    expect(fetchHistoryMock).not.toHaveBeenCalled();

    rerender({ enabled: true });

    expect(result.current.isLoading).toBe(true);
    expect(fetchHistoryMock).toHaveBeenCalledExactlyOnceWith(user, 0);

    rerender({ enabled: true });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      page.resolve({ items: [notification], hasMore: false, nextOffset: null });
    });

    expect(result.current.notifications).toEqual([notification]);
    expect(result.current.isLoading).toBe(false);
  });

  it("clears the previous error when history is enabled again", async () => {
    const page = createDeferred<NotificationHistoryPage>();
    fetchHistoryMock
      .mockRejectedValueOnce(new Error("History unavailable"))
      .mockReturnValueOnce(page.promise);

    const { result, rerender } = renderHook(
      ({ enabled }) => useNotificationHistory({ user, enabled }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe("Неуспешно зареждане на известията");

    rerender({ enabled: false });
    expect(result.current.error).toBe("Неуспешно зареждане на известията");

    rerender({ enabled: true });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(fetchHistoryMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      page.resolve({ items: [], hasMore: false, nextOffset: null });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps loaded items visible while pagination and manual refresh are pending", async () => {
    const nextPage = createDeferred<NotificationHistoryPage>();
    const refreshedPage = createDeferred<NotificationHistoryPage>();
    const firstNotification = createNotification("notification-1");
    const secondNotification = createNotification("notification-2");
    fetchHistoryMock
      .mockResolvedValueOnce({
        items: [firstNotification],
        hasMore: true,
        nextOffset: 20,
      })
      .mockReturnValueOnce(nextPage.promise)
      .mockReturnValueOnce(refreshedPage.promise);

    const { result } = renderHook(() =>
      useNotificationHistory({ user, enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.isLoadingMore).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.notifications).toEqual([firstNotification]);
    expect(fetchHistoryMock).toHaveBeenNthCalledWith(2, user, 20);

    await act(async () => {
      nextPage.resolve({
        items: [secondNotification],
        hasMore: false,
        nextOffset: null,
      });
    });

    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.notifications).toEqual([
      firstNotification,
      secondNotification,
    ]);

    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh();
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.notifications).toHaveLength(2);
    expect(fetchHistoryMock).toHaveBeenNthCalledWith(3, user, 0);

    await act(async () => {
      refreshedPage.resolve({
        items: [secondNotification],
        hasMore: false,
        nextOffset: null,
      });
      await refresh;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.notifications).toEqual([secondNotification]);
  });

  it("preserves the initial loading option while history is disabled", () => {
    const { result } = renderHook(() =>
      useNotificationHistory({ user, enabled: false, initialLoading: true }),
    );

    expect(result.current.isLoading).toBe(true);
    expect(fetchHistoryMock).not.toHaveBeenCalled();
  });

  it("clears an initial request error immediately when manually retrying", async () => {
    const page = createDeferred<NotificationHistoryPage>();
    const notification = createNotification("recovered-notification");
    fetchHistoryMock
      .mockRejectedValueOnce(new Error("History unavailable"))
      .mockReturnValueOnce(page.promise);

    const { result } = renderHook(() =>
      useNotificationHistory({ user, enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe("Неуспешно зареждане на известията");

    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh();
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(fetchHistoryMock).toHaveBeenNthCalledWith(2, user, 0);

    await act(async () => {
      page.resolve({ items: [notification], hasMore: false, nextOffset: null });
      await refresh;
    });

    expect(result.current.notifications).toEqual([notification]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("preserves items after a failed next page and retries the same offset once", async () => {
    const retryPage = createDeferred<NotificationHistoryPage>();
    const firstNotification = createNotification("notification-1");
    const secondNotification = createNotification("notification-2");
    fetchHistoryMock
      .mockResolvedValueOnce({
        items: [firstNotification],
        hasMore: true,
        nextOffset: 20,
      })
      .mockRejectedValueOnce(new Error("Next page unavailable"))
      .mockReturnValueOnce(retryPage.promise);

    const { result } = renderHook(() =>
      useNotificationHistory({ user, enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
    });

    expect(result.current.notifications).toEqual([firstNotification]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBe("Неуспешно зареждане на известията");

    act(() => {
      result.current.loadMore();
    });
    expect(result.current.isLoadingMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(3);
    expect(fetchHistoryMock).toHaveBeenNthCalledWith(3, user, 20);

    await act(async () => {
      retryPage.resolve({
        items: [secondNotification],
        hasMore: false,
        nextOffset: null,
      });
    });

    expect(result.current.notifications).toEqual([
      firstNotification,
      secondNotification,
    ]);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);

    act(() => {
      result.current.loadMore();
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(3);
  });

  it("ignores notification actions while signed out and loads after login", async () => {
    const notification = createNotification("notification-1");
    const onUnreadCountChange = vi.fn();
    fetchHistoryMock.mockResolvedValue({
      items: [notification],
      hasMore: false,
      nextOffset: null,
    });

    const { result, rerender } = renderHook(
      ({ currentUser }) =>
        useNotificationHistory({
          user: currentUser,
          enabled: true,
          onUnreadCountChange,
        }),
      { initialProps: { currentUser: null as User | null } },
    );

    await act(async () => {
      await result.current.refresh();
      await result.current.markAsRead(notification.id);
      await result.current.markAllRead();
      result.current.loadMore();
    });

    expect(result.current.isLoading).toBe(false);
    expect(fetchHistoryMock).not.toHaveBeenCalled();
    expect(markReadMock).not.toHaveBeenCalled();
    expect(markAllReadMock).not.toHaveBeenCalled();
    expect(onUnreadCountChange).not.toHaveBeenCalled();

    rerender({ currentUser: user });

    expect(result.current.isLoading).toBe(true);
    expect(fetchHistoryMock).toHaveBeenCalledExactlyOnceWith(user, 0);
    await waitFor(() => {
      expect(result.current.notifications).toEqual([notification]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("marks only the selected notification and refreshes the server unread count", async () => {
    const firstNotification = createNotification("notification-1");
    const secondNotification = createNotification("notification-2");
    const onUnreadCountChange = vi.fn();
    fetchHistoryMock.mockResolvedValue({
      items: [firstNotification, secondNotification],
      hasMore: false,
      nextOffset: null,
    });
    fetchUnreadCountMock.mockResolvedValue(7);

    const { result } = renderHook(() =>
      useNotificationHistory({
        user,
        enabled: true,
        onUnreadCountChange,
        refreshUnreadCountFromServer: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(firstNotification.id);
    });

    expect(markReadMock).toHaveBeenCalledExactlyOnceWith(
      user,
      firstNotification.id,
    );
    expect(result.current.notifications[0].readAt).toEqual(expect.any(String));
    expect(result.current.notifications[1]).toEqual(secondNotification);
    expect(fetchUnreadCountMock).toHaveBeenCalledExactlyOnceWith(user);
    expect(onUnreadCountChange).toHaveBeenCalledExactlyOnceWith(7);
  });

  it.each([true, false])(
    "emits the bulk-read event independently of the unread callback being %s",
    async (withUnreadCallback) => {
      const notifications = [
        createNotification("notification-1"),
        createNotification("notification-2"),
      ];
      const onUnreadCountChange = vi.fn();
      const dispatchEvent = vi.spyOn(globalThis.window, "dispatchEvent");
      fetchHistoryMock.mockResolvedValue({
        items: notifications,
        hasMore: false,
        nextOffset: null,
      });

      const { result } = renderHook(() =>
        useNotificationHistory({
          user,
          enabled: true,
          emitUnreadCountEvent: true,
          onUnreadCountChange: withUnreadCallback
            ? onUnreadCountChange
            : undefined,
        }),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.markAllRead();
      });

      expect(markAllReadMock).toHaveBeenCalledExactlyOnceWith(user);
      expect(result.current.notifications).toHaveLength(2);
      const readAt = result.current.notifications[0].readAt;
      expect(readAt).toEqual(expect.any(String));
      expect(result.current.notifications[1].readAt).toBe(readAt);
      expect(dispatchEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: "notifications:unread-count-changed",
          detail: { count: 0 },
        }),
      );
      expect(fetchUnreadCountMock).not.toHaveBeenCalled();
      if (withUnreadCallback) {
        expect(onUnreadCountChange).toHaveBeenCalledExactlyOnceWith(0);
      } else {
        expect(onUnreadCountChange).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps a successful read update when refreshing its unread count fails", async () => {
    const notification = createNotification("notification-1");
    const onUnreadCountChange = vi.fn();
    fetchHistoryMock.mockResolvedValue({
      items: [notification],
      hasMore: false,
      nextOffset: null,
    });
    fetchUnreadCountMock.mockRejectedValue(new Error("Unread count unavailable"));

    const { result } = renderHook(() =>
      useNotificationHistory({
        user,
        enabled: true,
        onUnreadCountChange,
        refreshUnreadCountFromServer: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    await act(async () => {
      await result.current.markAllRead();
    });

    expect(result.current.notifications[0].readAt).toEqual(expect.any(String));
    expect(onUnreadCountChange).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(consoleErrorMock).toHaveBeenCalledWith(
      "Error fetching unread notification count:",
      expect.any(Error),
    );
  });

  it.each(["single", "all"])(
    "keeps notification read state unchanged when the %s read request fails",
    async (action) => {
      const notification = createNotification("notification-1");
      const onUnreadCountChange = vi.fn();
      fetchHistoryMock.mockResolvedValue({
        items: [notification],
        hasMore: false,
        nextOffset: null,
      });

      const { result } = renderHook(() =>
        useNotificationHistory({
          user,
          enabled: true,
          onUnreadCountChange,
        }),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      if (action === "single") {
        markReadMock.mockRejectedValueOnce(new Error("Read request failed"));
        await act(async () => {
          await result.current.markAsRead(notification.id);
        });
      } else {
        markAllReadMock.mockRejectedValueOnce(new Error("Read request failed"));
        await act(async () => {
          await result.current.markAllRead();
        });
      }

      expect(result.current.notifications).toEqual([notification]);
      expect(onUnreadCountChange).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();
      expect(consoleErrorMock).toHaveBeenCalledWith(
        action === "single"
          ? "Error marking notification as read:"
          : "Error marking all notifications as read:",
        expect.any(Error),
      );
    },
  );
});
