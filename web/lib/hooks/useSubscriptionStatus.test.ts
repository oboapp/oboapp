import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { User } from "firebase/auth";
import { useSubscriptionStatus } from "./useSubscriptionStatus";

const {
  isMessagingSupportedMock,
  getMessagingMock,
  getTokenMock,
  fetchWithAuthMock,
  sentryCaptureExceptionMock,
} = vi.hoisted(() => ({
  isMessagingSupportedMock: vi.fn(),
  getMessagingMock: vi.fn(),
  getTokenMock: vi.fn(),
  fetchWithAuthMock: vi.fn(),
  sentryCaptureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentryCaptureExceptionMock,
}));

vi.mock("@/lib/notification-service", () => ({
  isMessagingSupported: isMessagingSupportedMock,
}));

vi.mock("firebase/messaging", () => ({
  getMessaging: getMessagingMock,
  getToken: getTokenMock,
}));

vi.mock("@/lib/firebase", () => ({
  app: {},
}));

vi.mock("@/lib/auth-fetch", () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

describe("useSubscriptionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    isMessagingSupportedMock.mockResolvedValue(true);
    getMessagingMock.mockReturnValue({});
    getTokenMock.mockResolvedValue("token-1");
    fetchWithAuthMock.mockResolvedValue(
      new Response(JSON.stringify([{ token: "token-1" }]), { status: 200 }),
    );

    vi.stubGlobal("Notification", { permission: "granted" });

    vi.stubEnv("NEXT_PUBLIC_FIREBASE_VAPID_KEY", "test-vapid-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("keeps last known subscription status when backend check fails", async () => {
    const user = { uid: "user-1" } as User;
    const { result } = renderHook(() => useSubscriptionStatus(user));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(true);
    expect(result.current.hasAnySubscriptions).toBe(true);
    expect(result.current.hasStatusCheckError).toBe(false);

    fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await act(async () => {
      await result.current.checkStatus();
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(true);
    expect(result.current.hasAnySubscriptions).toBe(true);
    expect(result.current.hasStatusCheckError).toBe(true);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("resets state when user changes before a failed status check", async () => {
    const user1 = { uid: "user-1" } as User;
    const user2 = { uid: "user-2" } as User;
    const { result, rerender } = renderHook(
      ({ user }) => useSubscriptionStatus(user),
      { initialProps: { user: user1 } },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(true);
    expect(result.current.hasAnySubscriptions).toBe(true);

    fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await act(async () => {
      rerender({ user: user2 });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(false);
    expect(result.current.hasAnySubscriptions).toBe(false);
    expect(result.current.hasStatusCheckError).toBe(true);
  });
});
