import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { User } from "firebase/auth";
import { useSubscriptionStatus } from "./useSubscriptionStatus";

const {
  isMessagingSupportedMock,
  getMessagingMock,
  getTokenMock,
  fetchWithAuthMock,
} = vi.hoisted(() => ({
  isMessagingSupportedMock: vi.fn(),
  getMessagingMock: vi.fn(),
  getTokenMock: vi.fn(),
  fetchWithAuthMock: vi.fn(),
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
    const user = {} as User;
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
  });
});
