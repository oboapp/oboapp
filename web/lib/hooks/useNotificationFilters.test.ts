import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationFilters } from "./useNotificationFilters";

const { useAuthMock, fetchWithAuthMock, consoleErrorMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  fetchWithAuthMock: vi.fn(),
  consoleErrorMock: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth-fetch", () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    vi.spyOn(console, "error").mockImplementation(consoleErrorMock);
    useAuthMock.mockReturnValue({ user });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderSavedFilters() {
    fetchWithAuthMock.mockResolvedValueOnce(Response.json(savedFilters));
    const hook = renderHook(() => useNotificationFilters());
    await waitFor(() => {
      expect(hook.result.current.isLoading).toBe(false);
    });
    return hook;
  }

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

  it.each(["http", "network"])(
    "reports a failed %s load and recovers when the account request restarts",
    async (failure) => {
      if (failure === "http") {
        fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      } else {
        fetchWithAuthMock.mockRejectedValueOnce(new Error("Network unavailable"));
      }
      const { result, rerender } = renderHook(() => useNotificationFilters());
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.error).toBe("Грешка при зареждане на филтрите");
      expect(result.current.isDirty).toBe(false);
      expect(result.current.selectedCategories.size).toBe(0);

      const response = createDeferred<Response>();
      fetchWithAuthMock.mockReturnValueOnce(response.promise);
      useAuthMock.mockReturnValue({ user: { uid: user.uid } as User });
      rerender();
      expect(result.current.isLoading).toBe(true);
      expect(result.current.error).toBeNull();
      await act(async () => {
        response.resolve(Response.json({
          notificationCategories: ["electricity"],
          notificationSources: ["erm-zapad"],
        }));
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.selectedCategories).toEqual(new Set(["electricity"]));
      expect(result.current.selectedSources).toEqual(new Set(["erm-zapad"]));
      expect(result.current.experimentalFeatures).toBe(false);
      expect(result.current.isDirty).toBe(false);
    },
  );

  it("tracks changed category and source membership and restores saved selections", async () => {
    const { result } = await renderSavedFilters();
    const originalCategories = result.current.selectedCategories;
    const originalSources = result.current.selectedSources;

    act(() => {
      result.current.toggleCategory("water");
    });
    expect(result.current.selectedCategories.size).toBe(0);
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.toggleCategory("electricity");
    });
    expect(result.current.selectedCategories).toEqual(new Set(["electricity"]));
    expect(result.current.isDirty).toBe(true);
    expect(originalCategories).toEqual(new Set(["water"]));
    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.selectedCategories).toEqual(new Set(["water"]));
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.toggleSource("sofiyska-voda");
    });
    expect(result.current.selectedSources.size).toBe(0);
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.toggleSource("erm-zapad");
    });
    expect(result.current.selectedSources).toEqual(new Set(["erm-zapad"]));
    expect(result.current.isDirty).toBe(true);
    expect(originalSources).toEqual(new Set(["sofiyska-voda"]));
    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.selectedSources).toEqual(new Set(["sofiyska-voda"]));
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setExperimentalFeatures(false);
    });
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.experimentalFeatures).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it("deduplicates bulk selections and clears all filters without changing the saved values", async () => {
    const { result } = await renderSavedFilters();
    act(() => {
      result.current.selectAllCategories(["water", "electricity", "water"]);
      result.current.selectAllSources(["sofiyska-voda", "erm-zapad", "erm-zapad"]);
    });
    expect(result.current.selectedCategories).toEqual(new Set(["water", "electricity"]));
    expect(result.current.selectedSources).toEqual(new Set(["sofiyska-voda", "erm-zapad"]));
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.deselectAllCategories();
      result.current.deselectAllSources();
    });
    expect(result.current.selectedCategories.size).toBe(0);
    expect(result.current.selectedSources.size).toBe(0);
    expect(result.current.experimentalFeatures).toBe(true);
    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.clearAll();
    });
    expect(result.current.selectedCategories.size).toBe(0);
    expect(result.current.selectedSources.size).toBe(0);
    expect(result.current.experimentalFeatures).toBe(false);
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.selectedCategories).toEqual(new Set(["water"]));
    expect(result.current.selectedSources).toEqual(new Set(["sofiyska-voda"]));
    expect(result.current.experimentalFeatures).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it("saves the current selection and adopts the server's normalized filters", async () => {
    const { result } = await renderSavedFilters();
    act(() => {
      result.current.selectAllCategories(["water", "electricity"]);
      result.current.selectAllSources(["erm-zapad"]);
      result.current.setExperimentalFeatures(false);
    });
    const response = createDeferred<Response>();
    fetchWithAuthMock.mockReturnValueOnce(response.promise);
    let save!: Promise<boolean>;
    act(() => {
      save = result.current.save();
    });
    expect(result.current.isSaving).toBe(true);
    expect(result.current.error).toBeNull();
    expect(fetchWithAuthMock).toHaveBeenLastCalledWith(user, "/api/notifications/filters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationCategories: ["water", "electricity"],
        notificationSources: ["erm-zapad"],
        experimentalFeatures: false,
      }),
    });
    await act(async () => {
      response.resolve(Response.json({
        notificationCategories: ["electricity"],
        notificationSources: ["erm-zapad"],
      }));
      expect(await save).toBe(true);
    });

    expect(result.current.isSaving).toBe(false);
    expect(result.current.selectedCategories).toEqual(new Set(["electricity"]));
    expect(result.current.selectedSources).toEqual(new Set(["erm-zapad"]));
    expect(result.current.experimentalFeatures).toBe(false);
    expect(result.current.isDirty).toBe(false);
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.resetToSaved();
    });
    expect(result.current.selectedCategories).toEqual(new Set(["electricity"]));
    expect(result.current.experimentalFeatures).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it.each(["http", "network"])(
    "keeps unsaved selections after a failed %s save and allows a retry",
    async (failure) => {
      const { result } = await renderSavedFilters();
      act(() => {
        result.current.toggleCategory("electricity");
      });
      if (failure === "http") {
        fetchWithAuthMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      } else {
        fetchWithAuthMock.mockRejectedValueOnce(new Error("Network unavailable"));
      }
      await act(async () => {
        expect(await result.current.save()).toBe(false);
      });
      expect(result.current.isSaving).toBe(false);
      expect(result.current.error).toBe("Грешка при запазване на филтрите");
      expect(result.current.selectedCategories).toEqual(new Set(["water", "electricity"]));
      expect(result.current.isDirty).toBe(true);

      const response = createDeferred<Response>();
      fetchWithAuthMock.mockReturnValueOnce(response.promise);
      let retry!: Promise<boolean>;
      act(() => {
        retry = result.current.save();
      });
      expect(result.current.isSaving).toBe(true);
      expect(result.current.error).toBeNull();
      await act(async () => {
        response.resolve(Response.json({
          ...savedFilters,
          notificationCategories: ["water", "electricity"],
        }));
        expect(await retry).toBe(true);
      });

      expect(result.current.isSaving).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.selectedCategories).toEqual(new Set(["water", "electricity"]));
      expect(result.current.isDirty).toBe(false);
    },
  );

  it("does not save while signed out", async () => {
    useAuthMock.mockReturnValue({ user: null });
    const { result } = renderHook(() => useNotificationFilters());
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });

    expect(fetchWithAuthMock).not.toHaveBeenCalled();
    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("ignores a stale request failure after the next account's filters have loaded", async () => {
    const staleResponse = createDeferred<Response>();
    fetchWithAuthMock.mockReturnValueOnce(staleResponse.promise);
    const { result, rerender } = renderHook(() => useNotificationFilters());
    fetchWithAuthMock.mockResolvedValueOnce(Response.json(savedFilters));
    useAuthMock.mockReturnValue({ user: { uid: "next-user" } as User });
    rerender();
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    await act(async () => {
      staleResponse.reject(new Error("Previous account request failed"));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.selectedCategories).toEqual(new Set(["water"]));
    expect(result.current.selectedSources).toEqual(new Set(["sofiyska-voda"]));
    expect(result.current.experimentalFeatures).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });
});
