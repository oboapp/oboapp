import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationHistoryPage } from "@/lib/notification-history";
import type { NotificationHistoryItem } from "@/lib/types";
import { useNotificationHistory } from "./useNotificationHistory";

const fetchHistoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notification-history", () => ({
  fetchNotificationHistory: fetchHistoryMock,
  fetchUnreadNotificationCount: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  markNotificationAsRead: vi.fn(),
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

  beforeEach(() => {
    vi.resetAllMocks();
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
});
