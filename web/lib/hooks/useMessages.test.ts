import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalMessage } from "@/lib/types";
import { useMessages } from "./useMessages";

const fetchMock = vi.fn<typeof fetch>();
const consoleError = vi.fn();
const firstBounds = { north: 42.8, south: 42.7, east: 23.4, west: 23.3, zoom: 15 };
const movedBounds = { north: 42.9, south: 42.8, east: 23.5, west: 23.4, zoom: 14 };

function message(id: string): InternalMessage {
  return {
    id,
    text: id,
    createdAt: "2026-11-06T12:00:00Z",
    locality: "bg.sofia",
    aiProcessed: true,
  };
}

function response(messages: InternalMessage[] = []): Response {
  return Response.json({ messages });
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

function requestUrl(index = fetchMock.mock.calls.length - 1): URL {
  return new URL(String(fetchMock.mock.calls[index][0]), "https://obo.test");
}

function requestSignal(index: number) {
  return fetchMock.mock.calls[index][1]?.signal;
}

async function flushRequests() {
  await act(async () => {});
}

async function advanceTime(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("useMessages scope", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    consoleError.mockReset();
    fetchMock.mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(consoleError);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waits for debounced bounds in the default viewport scope", async () => {
    const events = [message("visible")];
    fetchMock.mockResolvedValueOnce(response(events));
    const { result } = renderHook(() => useMessages());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);

    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    await advanceTime(299);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);

    await advanceTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl().searchParams.get("north")).toBe("42.8");
    expect(result.current.messages).toEqual(events);
    expect(result.current.isLoading).toBe(false);
  });

  it("loads full events without bounds and keeps requests, loading, and results stable on map movement", async () => {
    const events = [message("all-zones")];
    fetchMock.mockResolvedValueOnce(response(events));
    const { result } = renderHook(() => useMessages({ scope: "all" }));
    await flushRequests();
    const loadedMessages = result.current.messages;

    expect(requestUrl().pathname).toBe("/api/messages");
    expect(requestUrl().search).toBe("");
    expect(result.current.isLoading).toBe(false);
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
      result.current.handleBoundsChanged(movedBounds);
    });
    await advanceTime(1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toBe(loadedMessages);
    expect(result.current.messages).toEqual(events);
    expect(result.current.isLoading).toBe(false);
  });

  it("waits for fresh camera bounds after resetting the viewport", async () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    await advanceTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleBoundsChanged(movedBounds);
      result.current.resetViewport();
    });
    await advanceTime(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([]);

    act(() => {
      result.current.handleBoundsChanged(movedBounds);
    });
    await advanceTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl().searchParams.get("north")).toBe("42.9");
  });

  it("drops old detail-navigation suppression when a new view owns the camera", async () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.suppressNextViewportFetch();
      result.current.resetViewport();
      result.current.handleBoundsChanged(movedBounds);
    });
    await advanceTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl().searchParams.get("north")).toBe("42.9");
  });

  it("restores the actual latest camera when switching back to Events", async () => {
    const { result, rerender } = renderHook(useMessages, {
      initialProps: { scope: "viewport" as "viewport" | "all" },
    });
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    await advanceTime(300);

    rerender({ scope: "all" });
    await flushRequests();
    act(() => {
      result.current.suppressNextViewportFetch();
      result.current.handleBoundsChanged(movedBounds);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    rerender({ scope: "viewport" });
    await flushRequests();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestUrl().searchParams.get("north")).toBe("42.9");
    expect(requestUrl().searchParams.get("west")).toBe("23.4");
  });

  it("cancels an old viewport debounce when entering the all-events scope", async () => {
    const { result, rerender } = renderHook(useMessages, {
      initialProps: { scope: "viewport" as "viewport" | "all" },
    });
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    rerender({ scope: "all" });
    act(() => {
      result.current.handleBoundsChanged(movedBounds);
    });
    await advanceTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ scope: "viewport" });
    await flushRequests();
    expect(requestUrl().searchParams.get("north")).toBe("42.9");
  });

  it.each(["viewport", "all"] as const)(
    "keeps category and source filters in %s requests",
    async (scope) => {
      const { result } = renderHook(() => useMessages({ scope }));
      act(() => {
        result.current.handleBoundsChanged(firstBounds);
      });
      await advanceTime(300);
      act(() => {
        result.current.setSelectedCategories(new Set(["water"]));
        result.current.setSelectedSources(new Set(["water-provider", "transport"]));
      });
      await flushRequests();

      expect(requestUrl().searchParams.get("categories")).toBe("water");
      expect(requestUrl().searchParams.get("sources")).toBe("water-provider,transport");
      expect(requestUrl().searchParams.has("north")).toBe(scope === "viewport");
      expect(requestUrl().searchParams.has("zoom")).toBe(false);

      act(() => {
        result.current.setSelectedCategories(new Set());
        result.current.setSelectedSources(new Set());
      });
      await flushRequests();
      expect(requestUrl().searchParams.has("categories")).toBe(false);
      expect(requestUrl().searchParams.has("sources")).toBe(false);
    },
  );

  it("does not fetch without viewport bounds, including after message submission", async () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      globalThis.dispatchEvent(new Event("messageSubmitted"));
    });
    await advanceTime(2000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("clears disabled data and loading, ignores a late response, and fetches again when enabled", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(useMessages, {
      initialProps: { scope: "all" as const, enabled: true },
    });
    expect(result.current.isLoading).toBe(true);

    rerender({ scope: "all", enabled: false });
    expect(requestSignal(0)?.aborted).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    act(() => {
      result.current.handleBoundsChanged(movedBounds);
    });
    await act(async () => {
      pending.resolve(response([message("obsolete")]));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    rerender({ scope: "all", enabled: true });
    await flushRequests();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.messages).toEqual([]);
  });

  it("starts all-events loading without bounds after zones become ready", async () => {
    const { rerender } = renderHook(useMessages, {
      initialProps: { scope: "all" as const, enabled: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ scope: "all", enabled: true });
    await flushRequests();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl().search).toBe("");
  });

  it("ignores a stale viewport body that finishes after the all-events request", async () => {
    const oldBody = deferred<{ messages: InternalMessage[] }>();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => oldBody.promise,
    } as Response);
    const events = [message("all-zones")];
    fetchMock.mockResolvedValueOnce(response(events));
    const { result, rerender } = renderHook(useMessages, {
      initialProps: { scope: "viewport" as "viewport" | "all" },
    });
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    await advanceTime(300);
    expect(result.current.isLoading).toBe(true);

    rerender({ scope: "all" });
    await flushRequests();
    expect(requestSignal(0)?.aborted).toBe(true);
    expect(result.current.messages).toEqual(events);
    await act(async () => {
      oldBody.resolve({ messages: [message("viewport")] });
    });
    expect(result.current.messages).toEqual(events);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("ignores out-of-order results after a filter change even when fetch ignores abort", async () => {
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldRequest.promise);
    fetchMock.mockReturnValueOnce(newRequest.promise);
    const { result } = renderHook(() => useMessages({ scope: "all" }));
    act(() => {
      result.current.setSelectedCategories(new Set(["water"]));
    });
    expect(requestSignal(0)?.aborted).toBe(true);

    const currentMessages = [message("water")];
    await act(async () => {
      newRequest.resolve(response(currentMessages));
    });
    await act(async () => {
      oldRequest.resolve(response([message("all-categories")]));
    });
    expect(result.current.messages).toEqual(currentMessages);
    expect(result.current.isLoading).toBe(false);
  });

  it("ignores failures from a previous request after the scope changes", async () => {
    const oldRequest = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldRequest.promise);
    const { result, rerender } = renderHook(useMessages, {
      initialProps: { scope: "all" as "viewport" | "all" },
    });
    rerender({ scope: "viewport" });
    await act(async () => {
      oldRequest.reject(new TypeError("Failed to fetch"));
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("refreshes the current scope after message submission", async () => {
    const { result, rerender } = renderHook(useMessages, {
      initialProps: { scope: "viewport" as "viewport" | "all" },
    });
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    await advanceTime(300);
    act(() => {
      globalThis.dispatchEvent(new Event("messageSubmitted"));
    });
    rerender({ scope: "all" });
    await flushRequests();
    act(() => {
      result.current.setSelectedSources(new Set(["water-provider"]));
      result.current.handleBoundsChanged(movedBounds);
    });
    await flushRequests();
    const countBeforeRefresh = fetchMock.mock.calls.length;
    await advanceTime(2000);

    expect(fetchMock).toHaveBeenCalledTimes(countBeforeRefresh + 1);
    expect(requestUrl().searchParams.get("sources")).toBe("water-provider");
    expect(requestUrl().searchParams.has("north")).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("skips submission refreshes while disabled and cleans up pending timers and requests", async () => {
    const { result, rerender, unmount } = renderHook(useMessages, {
      initialProps: { scope: "all" as const, enabled: false },
    });
    act(() => {
      globalThis.dispatchEvent(new Event("messageSubmitted"));
    });
    await advanceTime(2000);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ scope: "all", enabled: true });
    await flushRequests();
    act(() => {
      globalThis.dispatchEvent(new Event("messageSubmitted"));
      globalThis.dispatchEvent(new Event("messageSubmitted"));
      result.current.suppressNextViewportFetch();
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(requestSignal(0)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await advanceTime(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves one-shot viewport suppression for event-detail camera moves", async () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    await advanceTime(300);
    act(() => {
      result.current.suppressNextViewportFetch();
      result.current.handleBoundsChanged(movedBounds);
    });
    await advanceTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleBoundsChanged(movedBounds);
    });
    await advanceTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl().searchParams.get("north")).toBe("42.9");
  });

  it("resets the suppression timeout when another programmatic move starts", async () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.handleBoundsChanged(firstBounds);
    });
    await advanceTime(300);
    act(() => {
      result.current.suppressNextViewportFetch();
    });
    await advanceTime(400);
    act(() => {
      result.current.suppressNextViewportFetch();
      result.current.handleBoundsChanged(movedBounds);
    });
    await advanceTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a current fetch error and clears it when fetching is disabled", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result, rerender } = renderHook(useMessages, {
      initialProps: { scope: "all" as const, enabled: true },
    });
    await flushRequests();
    expect(result.current.error).toContain("Провери интернет връзката си");
    expect(result.current.isLoading).toBe(false);

    rerender({ scope: "all", enabled: false });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
