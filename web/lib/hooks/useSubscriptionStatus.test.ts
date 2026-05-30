import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { User } from "firebase/auth";
import { useSubscriptionStatus } from "./useSubscriptionStatus";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveFn) => {
    resolve = resolveFn;
  });
  return { promise, resolve };
}

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

  it("sets unsubscribed state when initial backend check fails", async () => {
    const user = { uid: "user-initial-failure" } as User;
    fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    const { result } = renderHook(() => useSubscriptionStatus(user));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(false);
    expect(result.current.hasAnySubscriptions).toBe(false);
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

  it("reports exception failures on repeated checks", async () => {
    const user = { uid: "user-1" } as User;
    const { result } = renderHook(() => useSubscriptionStatus(user));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    fetchWithAuthMock.mockRejectedValueOnce(new Error("network failure 1"));
    await act(async () => {
      await result.current.checkStatus();
    });

    fetchWithAuthMock.mockRejectedValueOnce(new Error("network failure 2"));
    await act(async () => {
      await result.current.checkStatus();
    });

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("clears non-ok warning dedupe when user logs out", async () => {
    const user = { uid: "user-1" } as User;
    const { result, rerender } = renderHook(
      ({ currentUser }) => useSubscriptionStatus(currentUser),
      { initialProps: { currentUser: user as User | null } },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ currentUser: null });
    });

    fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await act(async () => {
      rerender({ currentUser: user });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("clears non-ok warning dedupe when user changes", async () => {
    const user1 = { uid: "user-1" } as User;
    const user2 = { uid: "user-2" } as User;
    const { result, rerender } = renderHook(
      ({ user }) => useSubscriptionStatus(user),
      { initialProps: { user: user1 } },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);

    fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await act(async () => {
      rerender({ user: user2 });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("skips stale backend fetch when an older token lookup completes late", async () => {
    const user1 = { uid: "user-1" } as User;
    const user2 = { uid: "user-2" } as User;
    const deferredToken = createDeferred<string | null>();

    getTokenMock
      .mockImplementationOnce(async () => deferredToken.promise)
      .mockResolvedValueOnce("token-1");

    const { rerender } = renderHook(
      ({ user }) => useSubscriptionStatus(user),
      { initialProps: { user: user1 } },
    );

    await waitFor(() => {
      expect(getTokenMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rerender({ user: user2 });
    });

    await act(async () => {
      deferredToken.resolve("token-1");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores stale in-flight results after user switch", async () => {
    const user1 = { uid: "user-1" } as User;
    const user2 = { uid: "user-2" } as User;
    const deferredResponse = createDeferred<Response>();

    fetchWithAuthMock
      .mockImplementationOnce(async () => deferredResponse.promise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ token: "token-1" }]), { status: 200 }),
      );

    const { result, rerender } = renderHook(
      ({ user }) => useSubscriptionStatus(user),
      { initialProps: { user: user1 } },
    );

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rerender({ user: user2 });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(true);
    expect(result.current.hasAnySubscriptions).toBe(true);

    await act(async () => {
      deferredResponse.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
        }),
      );
      await Promise.resolve();
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(true);
    expect(result.current.hasAnySubscriptions).toBe(true);
    expect(result.current.hasStatusCheckError).toBe(false);
  });

  it("ignores stale non-ok backend responses after user switch", async () => {
    const user1 = { uid: "user-1" } as User;
    const user2 = { uid: "user-2" } as User;
    const deferredResponse = createDeferred<Response>();

    fetchWithAuthMock
      .mockImplementationOnce(async () => deferredResponse.promise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ token: "token-1" }]), { status: 200 }),
      );

    const { result, rerender } = renderHook(
      ({ user }) => useSubscriptionStatus(user),
      { initialProps: { user: user1 } },
    );

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rerender({ user: user2 });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      deferredResponse.resolve(new Response(null, { status: 503 }));
      await Promise.resolve();
    });

    expect(result.current.isCurrentDeviceSubscribed).toBe(true);
    expect(result.current.hasAnySubscriptions).toBe(true);
    expect(result.current.hasStatusCheckError).toBe(false);
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
  });
});
