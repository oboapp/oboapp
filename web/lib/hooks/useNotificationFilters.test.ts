import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationFilters } from "./useNotificationFilters";

const { useAuthMock, fetchWithAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  fetchWithAuthMock: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth-fetch", () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const savedFilters = {
  notificationCategories: ["water"],
  notificationSources: ["sofiyska-voda"],
  experimentalFeatures: true,
};

describe("useNotificationFilters", () => {
  const user = { uid: "user-1" } as User;

  beforeEach(() => {
    vi.resetAllMocks();
    useAuthMock.mockReturnValue({ user });
  });

  it("starts one request immediately and keeps loading until filters arrive", async () => {
    const response = createDeferred<Response>();
    fetchWithAuthMock.mockReturnValue(response.promise);

    const { result, rerender } = renderHook(() => useNotificationFilters());

    expect(fetchWithAuthMock).toHaveBeenCalledExactlyOnceWith(
      user,
      "/api/notifications/filters",
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isDirty).toBe(false);

    rerender();
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      response.resolve(new Response(JSON.stringify(savedFilters)));
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.selectedCategories).toEqual(new Set(["water"]));
    expect(result.current.selectedSources).toEqual(new Set(["sofiyska-voda"]));
    expect(result.current.experimentalFeatures).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it("clears filters on logout and ignores the pending account request", async () => {
    const pendingResponse = createDeferred<Response>();
    fetchWithAuthMock
      .mockResolvedValueOnce(new Response(JSON.stringify(savedFilters)))
      .mockReturnValueOnce(pendingResponse.promise);

    const { result, rerender } = renderHook(() => useNotificationFilters());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const nextUser = { uid: "user-2" } as User;
    useAuthMock.mockReturnValue({ user: nextUser });
    rerender();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.selectedCategories).toEqual(new Set(["water"]));
    expect(fetchWithAuthMock).toHaveBeenNthCalledWith(
      2,
      nextUser,
      "/api/notifications/filters",
    );

    useAuthMock.mockReturnValue({ user: null });
    rerender();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.selectedCategories.size).toBe(0);
    expect(result.current.selectedSources.size).toBe(0);
    expect(result.current.experimentalFeatures).toBe(false);
    expect(result.current.isDirty).toBe(false);

    await act(async () => {
      pendingResponse.resolve(new Response(JSON.stringify(savedFilters)));
    });

    expect(result.current.selectedCategories.size).toBe(0);
    expect(result.current.experimentalFeatures).toBe(false);
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
  });

  it("does not request filters while signed out", () => {
    useAuthMock.mockReturnValue({ user: null });

    const { result } = renderHook(() => useNotificationFilters());

    expect(result.current.isLoading).toBe(false);
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
  });
});
