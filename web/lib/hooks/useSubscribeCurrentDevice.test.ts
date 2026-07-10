import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { useSubscribeCurrentDevice } from "@/lib/hooks/useSubscribeCurrentDevice";

const mockUseSubscriptionStatus = vi.hoisted(() => vi.fn());
const mockSubscribeCurrentDeviceForUser = vi.hoisted(() => vi.fn());
const mockGetEnableNotificationsMessage = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockCaptureException = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hooks/useSubscriptionStatus", () => ({
  useSubscriptionStatus: mockUseSubscriptionStatus,
}));

vi.mock("@/lib/notification-service", () => ({
  subscribeCurrentDeviceForUser: mockSubscribeCurrentDeviceForUser,
  getEnableNotificationsMessage: mockGetEnableNotificationsMessage,
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureException,
}));

const user = { uid: "user-1" } as User;

describe("useSubscribeCurrentDevice", () => {
  const checkStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseSubscriptionStatus.mockReturnValue({
      isCurrentDeviceSubscribed: true,
      hasAnySubscriptions: true,
      checkStatus,
    });

    mockGetEnableNotificationsMessage.mockReturnValue("Активирай известия");
  });

  it("returns subscriptionStatus from useSubscriptionStatus", () => {
    const { result } = renderHook(() => useSubscribeCurrentDevice(user));

    expect(result.current.subscriptionStatus).toEqual({
      isCurrentDeviceSubscribed: true,
      hasAnySubscriptions: true,
      checkStatus,
    });
  });

  it("returns a handleSubscribeCurrentDevice function", () => {
    const { result } = renderHook(() => useSubscribeCurrentDevice(user));

    expect(typeof result.current.handleSubscribeCurrentDevice).toBe("function");
  });

  it("does nothing when user is null", async () => {
    const { result } = renderHook(() => useSubscribeCurrentDevice(null));

    await act(async () => {
      await result.current.handleSubscribeCurrentDevice();
    });

    expect(mockSubscribeCurrentDeviceForUser).not.toHaveBeenCalled();
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it("calls checkStatus after a successful subscription", async () => {
    mockSubscribeCurrentDeviceForUser.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useSubscribeCurrentDevice(user));

    await act(async () => {
      await result.current.handleSubscribeCurrentDevice();
    });

    expect(mockSubscribeCurrentDeviceForUser).toHaveBeenCalledWith(user);
    expect(checkStatus).toHaveBeenCalledOnce();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows toast error when subscribe returns !ok and skips checkStatus", async () => {
    mockSubscribeCurrentDeviceForUser.mockResolvedValue({
      ok: false,
      reason: "permission-denied",
    });

    const { result } = renderHook(() => useSubscribeCurrentDevice(user));

    await act(async () => {
      await result.current.handleSubscribeCurrentDevice();
    });

    expect(mockGetEnableNotificationsMessage).toHaveBeenCalledWith(
      "permission-denied",
    );
    expect(mockToastError).toHaveBeenCalledWith("Активирай известия");
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it("captures exception and shows toast when subscribe throws", async () => {
    const subscribeError = new Error("network error");
    mockSubscribeCurrentDeviceForUser.mockRejectedValue(subscribeError);

    const { result } = renderHook(() => useSubscribeCurrentDevice(user));

    await act(async () => {
      await result.current.handleSubscribeCurrentDevice();
    });

    expect(mockCaptureException).toHaveBeenCalledWith(subscribeError, {
      level: "warning",
      tags: {
        area: "notifications",
        action: "subscribeCurrentDevice",
      },
    });
    expect(mockToastError).toHaveBeenCalledWith("Грешка при абонирането");
  });

  it("still calls checkStatus after subscribe throws", async () => {
    mockSubscribeCurrentDeviceForUser.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useSubscribeCurrentDevice(user));

    await act(async () => {
      await result.current.handleSubscribeCurrentDevice();
    });

    await waitFor(() => {
      expect(checkStatus).toHaveBeenCalledOnce();
    });
  });
});
