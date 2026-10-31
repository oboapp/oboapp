import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocalityBoundaries } from "./useLocalityBoundaries";

const boundary = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[23.2, 42.6], [23.4, 42.6], [23.4, 42.8], [23.2, 42.6]]],
    },
    properties: {},
  }],
};
const clients: QueryClient[] = [];

function renderBoundaries(localities: readonly string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  clients.push(client);

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }

  return renderHook(
    ({ requestedLocalities }) => useLocalityBoundaries(requestedLocalities),
    { initialProps: { requestedLocalities: localities }, wrapper },
  );
}

afterEach(() => {
  cleanup();
  for (const client of clients) {
    client.clear();
  }
  clients.length = 0;
  vi.unstubAllGlobals();
});

describe("useLocalityBoundaries", () => {
  it("does not fetch when no city-wide localities are requested", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderBoundaries([]);

    expect(result.current).toEqual({ boundaries: {}, isLoading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates localities and reuses cached data after leaving and returning", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(boundary));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderBoundaries(["bg.sofia", "bg.sofia"]);

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.boundaries).toEqual({ "bg.sofia": boundary });
    });
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/localities/bg.sofia/boundary",
      { signal: expect.anything() },
    );

    rerender({ requestedLocalities: [] });
    expect(result.current.boundaries).toEqual({});
    rerender({ requestedLocalities: ["bg.sofia"] });

    expect(result.current.boundaries).toEqual({ "bg.sofia": boundary });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns only the currently requested boundaries", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(boundary));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderBoundaries(["bg.sofia"]);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    rerender({ requestedLocalities: ["bg.other"] });

    expect(result.current.boundaries).toEqual({});
    await waitFor(() => {
      expect(result.current.boundaries).toEqual({ "bg.other": boundary });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps successful boundaries while reporting a failed locality", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("bg.sofia")) {
        return Response.json(boundary);
      }
      return new Response(null, { status: 404 });
    }));
    const { result } = renderBoundaries(["bg.sofia", "bg.missing"]);

    await waitFor(() => {
      expect(result.current.error).toContain("Презареди страницата");
    });
    expect(result.current.boundaries).toEqual({ "bg.sofia": boundary });
    expect(result.current.isLoading).toBe(false);
  });

  it.each([
    new Response(null, { status: 500 }),
    Response.json({ unexpected: true }),
  ])("reports failed or invalid responses without adding a boundary", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response.clone()));
    const { result } = renderBoundaries(["bg.sofia"]);

    await waitFor(() => {
      expect(result.current.error).toContain("Не успях да заредя границите");
    });
    expect(result.current.boundaries).toEqual({});
    expect(result.current.isLoading).toBe(false);
  });
});
