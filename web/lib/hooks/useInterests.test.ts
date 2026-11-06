import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Interest } from "@/lib/types";
import { useInterests } from "./useInterests";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { uid: "user-a", isAnonymous: false } as {
      uid: string;
      isAnonymous: boolean;
    } | null,
    loading: false,
  },
  fetchWithAuth: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mocks.auth,
}));
vi.mock("@/lib/auth-fetch", () => ({
  fetchWithAuth: mocks.fetchWithAuth,
}));
vi.mock("@/lib/analytics", () => ({
  trackEvent: mocks.trackEvent,
}));

function interest(userId: string, id = `zone-${userId}`): Interest {
  return {
    id,
    userId,
    coordinates: { lat: 42.7, lng: 23.3 },
    radius: 500,
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
  };
}

function deferred<T>() {
  let resolveValue: (value: T) => void = () => {
    throw new Error("Promise has not been created");
  };
  let rejectValue: (reason: unknown) => void = () => {
    throw new Error("Promise has not been created");
  };
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

function deferredResponse() {
  return deferred<Response>();
}

function zonesResponse(interests: Interest[]): Response {
  return Response.json({ interests });
}

type Mutation = "add" | "update" | "delete";

function mutate(hook: ReturnType<typeof useInterests>, operation: Mutation) {
  if (operation === "add") {
    return hook.addInterest({ lat: 42.71, lng: 23.31 });
  }

  if (operation === "update") {
    return hook.updateInterest("shared", { radius: 800 });
  }

  return hook.deleteInterest("shared");
}

describe("useInterests user readiness", () => {
  beforeEach(() => {
    mocks.auth.user = { uid: "user-a", isAnonymous: false };
    mocks.auth.loading = false;
    mocks.fetchWithAuth.mockReset();
    mocks.trackEvent.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for auth and the current user's zones before initializing", async () => {
    mocks.auth.loading = true;
    const pending = deferredResponse();
    mocks.fetchWithAuth.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(useInterests);

    expect(result.current.hasInitialized).toBe(false);
    expect(result.current.interests).toEqual([]);
    expect(mocks.fetchWithAuth).not.toHaveBeenCalled();

    mocks.auth.loading = false;
    rerender();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasInitialized).toBe(false);

    await act(async () => {
      pending.resolve(zonesResponse([interest("user-a")]));
    });

    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.interests).toEqual([interest("user-a")]);
  });

  it("hides the previous user's zones while a different user's zones load", async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([interest("user-a")]));
    const { result, rerender } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });

    const pending = deferredResponse();
    mocks.fetchWithAuth.mockReturnValueOnce(pending.promise);
    mocks.auth.user = { uid: "user-b", isAnonymous: false };
    rerender();

    expect(result.current.interests).toEqual([]);
    expect(result.current.hasInitialized).toBe(false);
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      pending.resolve(zonesResponse([interest("user-b")]));
    });

    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.interests).toEqual([interest("user-b")]);
  });

  it("does not treat an initialized signed-out session as a loaded guest", async () => {
    mocks.auth.user = null;
    const { result, rerender } = renderHook(useInterests);
    expect(result.current.hasInitialized).toBe(true);
    expect(mocks.fetchWithAuth).not.toHaveBeenCalled();

    const pending = deferredResponse();
    mocks.fetchWithAuth.mockReturnValue(pending.promise);
    mocks.auth.user = { uid: "guest", isAnonymous: true };
    rerender();
    expect(result.current.hasInitialized).toBe(false);

    await act(async () => {
      pending.resolve(zonesResponse([interest("guest")]));
    });

    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.interests).toEqual([interest("guest")]);
  });

  it("ignores a previous user's response that arrives after the new user's data", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    mocks.fetchWithAuth
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(useInterests);

    mocks.auth.user = { uid: "user-b", isAnonymous: false };
    rerender();

    await act(async () => {
      second.resolve(zonesResponse([interest("user-b")]));
    });
    await act(async () => {
      first.resolve(zonesResponse([interest("user-a")]));
    });

    expect(result.current.interests).toEqual([interest("user-b")]);
    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("keeps the new user's load pending when the previous user's request finishes first", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    mocks.fetchWithAuth
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(useInterests);
    mocks.auth.user = { uid: "user-b", isAnonymous: false };
    rerender();

    await act(async () => {
      first.resolve(zonesResponse([interest("user-a")]));
    });

    expect(result.current.interests).toEqual([]);
    expect(result.current.hasInitialized).toBe(false);
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      second.resolve(zonesResponse([interest("user-b")]));
    });

    expect(result.current.interests).toEqual([interest("user-b")]);
    expect(result.current.hasInitialized).toBe(true);
  });

  it("keeps a newer refresh when older requests complete out of order", async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([interest("user-a")]));
    const { result } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });
    const first = deferredResponse();
    const second = deferredResponse();
    mocks.fetchWithAuth
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let firstRefresh: Promise<void> | undefined;
    let secondRefresh: Promise<void> | undefined;
    act(() => {
      firstRefresh = result.current.refreshInterests();
      secondRefresh = result.current.refreshInterests();
    });

    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.interests).toEqual([interest("user-a")]);
    await act(async () => {
      second.resolve(zonesResponse([interest("user-a", "newer")]));
      await secondRefresh;
    });
    await act(async () => {
      first.resolve(zonesResponse([interest("user-a", "older")]));
      await firstRefresh;
    });

    expect(result.current.interests).toEqual([interest("user-a", "newer")]);
    expect(result.current.isLoading).toBe(false);
  });

  it("clears readiness during auth changes and discards an earlier response after sign-out", async () => {
    const pending = deferredResponse();
    mocks.fetchWithAuth.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(useInterests);
    mocks.auth.loading = true;
    rerender();
    expect(result.current.hasInitialized).toBe(false);

    mocks.auth.loading = false;
    mocks.auth.user = null;
    rerender();
    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.interests).toEqual([]);

    await act(async () => {
      pending.resolve(zonesResponse([interest("user-a")]));
    });

    expect(result.current.interests).toEqual([]);
    expect(result.current.hasInitialized).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("does not add a previous user's pending mutation to the new user's zones", async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([interest("user-a")]));
    const { result, rerender } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });
    const pendingAdd = deferredResponse();
    mocks.fetchWithAuth.mockReturnValueOnce(pendingAdd.promise);
    let add: Promise<Interest> | undefined;
    act(() => {
      add = result.current.addInterest({ lat: 42.71, lng: 23.31 });
    });
    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([interest("user-b")]));
    mocks.auth.user = { uid: "user-b", isAnonymous: false };
    rerender();
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });

    await act(async () => {
      pendingAdd.resolve(Response.json({ interest: interest("user-a", "added") }));
      await add;
    });

    expect(result.current.interests).toEqual([interest("user-b")]);
  });

  it.each(["update", "delete"] as const)(
    "ignores a previous user's pending %s even when zone IDs are shared",
    async (operation) => {
      mocks.fetchWithAuth.mockResolvedValueOnce(
        zonesResponse([interest("user-a", "shared")]),
      );
      const { result, rerender } = renderHook(useInterests);
      await waitFor(() => {
        expect(result.current.hasInitialized).toBe(true);
      });
      const pendingMutation = deferredResponse();
      mocks.fetchWithAuth.mockReturnValueOnce(pendingMutation.promise);
      let mutation: Promise<unknown> | undefined;
      act(() => {
        mutation = mutate(result.current, operation);
      });
      mocks.fetchWithAuth.mockResolvedValueOnce(
        zonesResponse([interest("user-b", "shared")]),
      );
      mocks.auth.user = { uid: "user-b", isAnonymous: false };
      rerender();
      await waitFor(() => {
        expect(result.current.hasInitialized).toBe(true);
      });

      await act(async () => {
        pendingMutation.resolve(Response.json({
          interest: { ...interest("user-a", "shared"), radius: 800 },
        }));
        await mutation;
      });

      expect(result.current.interests).toEqual([interest("user-b", "shared")]);
    },
  );

  it("adds, updates and deletes zones for the current guest", async () => {
    mocks.auth.user = { uid: "guest", isAnonymous: true };
    const original = interest("guest", "shared");
    const added = interest("guest", "added");
    const updated = { ...original, radius: 800 };
    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([original]));
    const { result } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });
    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json({ interest: added }));
    await act(async () => {
      expect(await result.current.addInterest(
        added.coordinates,
        added.radius,
        { label: "Работа", color: "#4285F4" },
      )).toEqual(added);
    });
    expect(result.current.interests).toEqual([added, original]);
    expect(mocks.trackEvent).toHaveBeenCalledWith({
      name: "guest_zone_created",
      params: { radius: added.radius },
    });

    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json({ interest: updated }));
    await act(async () => {
      expect(await result.current.updateInterest("shared", { radius: 800 }))
        .toEqual(updated);
    });
    expect(result.current.interests).toEqual([added, updated]);

    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json({}));
    await act(async () => {
      await result.current.deleteInterest("shared");
    });
    expect(result.current.interests).toEqual([added]);
  });

  it("keeps one zone when an add response repeats an existing zone ID", async () => {
    const original = interest("user-a", "shared");
    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([original]));
    const { result } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });
    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json({ interest: original }));
    await act(async () => {
      await result.current.addInterest(original.coordinates);
    });
    expect(result.current.interests).toEqual([original]);
  });

  it.each(["add", "update", "delete"] as const)(
    "requires authentication before %s",
    async (operation) => {
      mocks.auth.user = null;
      const { result } = renderHook(useInterests);

      await expect(mutate(result.current, operation)).rejects.toThrow(
        "Must be logged in",
      );
      expect(mocks.fetchWithAuth).not.toHaveBeenCalled();
    },
  );

  it.each([
    { operation: "add", online: true },
    { operation: "update", online: true },
    { operation: "delete", online: true },
    { operation: "add", online: false },
    { operation: "update", online: false },
    { operation: "delete", online: false },
  ] satisfies { operation: Mutation; online: boolean }[])(
    "keeps saved zones after failed $operation with online=$online",
    async ({ operation, online }) => {
      const original = interest("user-a", "shared");
      mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([original]));
      const { result } = renderHook(useInterests);
      await waitFor(() => {
        expect(result.current.hasInitialized).toBe(true);
      });
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
      mocks.fetchWithAuth.mockResolvedValueOnce(
        Response.json({ error: "Unavailable" }, { status: 503 }),
      );

      await act(async () => {
        await expect(mutate(result.current, operation)).rejects.toThrow(
          online ? "Failed to" : "Няма интернет връзка",
        );
      });

      expect(result.current.interests).toEqual([original]);
      expect(result.current.hasInitialized).toBe(true);
    },
  );

  it("exposes a failed load and clears its error after a successful refresh", async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(
      Response.json({ error: "Unavailable" }, { status: 503 }),
    );
    const { result } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });
    expect(result.current.error).toContain("503 - Unavailable");
    expect(result.current.isLoading).toBe(false);

    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([interest("user-a")]));
    await act(async () => {
      await result.current.refreshInterests();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.interests).toEqual([interest("user-a")]);
  });

  it.each([
    { online: false, failure: new Error("Fetch failed"), expected: "Няма интернет връзка" },
    { online: true, failure: new Error("Fetch failed"), expected: "Fetch failed" },
    { online: true, failure: "Fetch failed", expected: "Failed to load interests" },
  ])("reports load failures with online=$online and $expected", async ({ online, failure, expected }) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
    mocks.fetchWithAuth.mockRejectedValueOnce(failure);
    const { result } = renderHook(useInterests);

    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });

    expect(result.current.error).toContain(expected);
    expect(result.current.interests).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps the current user's data when the previous user's fetch fails late", async () => {
    const previous = deferredResponse();
    mocks.fetchWithAuth
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce(zonesResponse([interest("user-b")]));
    const { result, rerender } = renderHook(useInterests);
    mocks.auth.user = { uid: "user-b", isAnonymous: false };
    rerender();
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });

    await act(async () => {
      previous.reject(new Error("Previous user request failed"));
    });

    expect(result.current.interests).toEqual([interest("user-b")]);
    expect(result.current.error).toBeNull();
  });

  it("ignores stale data when the user changes while a response body is loading", async () => {
    const body = deferred<{ interests: Interest[] }>();
    const previous = zonesResponse([]);
    const parseBody = vi.spyOn(previous, "json").mockReturnValue(body.promise);
    mocks.fetchWithAuth.mockResolvedValueOnce(previous);
    const { result, rerender } = renderHook(useInterests);
    await waitFor(() => {
      expect(parseBody).toHaveBeenCalled();
    });
    const current = deferredResponse();
    mocks.fetchWithAuth.mockReturnValueOnce(current.promise);
    mocks.auth.user = { uid: "user-b", isAnonymous: false };
    rerender();

    await act(async () => {
      body.resolve({ interests: [interest("user-a")] });
    });
    expect(result.current.hasInitialized).toBe(false);
    expect(result.current.interests).toEqual([]);

    await act(async () => {
      current.resolve(zonesResponse([interest("user-b")]));
    });
    expect(result.current.interests).toEqual([interest("user-b")]);
  });

  it("removes duplicate API zones while preserving their first occurrence", async () => {
    const first = interest("user-a", "shared");
    mocks.fetchWithAuth.mockResolvedValueOnce(zonesResponse([
      first,
      { ...first, radius: 800 },
      interest("user-a", "other"),
    ]));
    const { result } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });

    expect(result.current.interests).toEqual([first, interest("user-a", "other")]);
  });

  it("handles a malformed zone-list value as an empty initialized result", async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json({ interests: {} }));
    const { result } = renderHook(useInterests);
    await waitFor(() => {
      expect(result.current.hasInitialized).toBe(true);
    });

    expect(result.current.interests).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
