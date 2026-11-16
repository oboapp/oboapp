import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistoryMapClient from "./HistoryMapClient";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  map: vi.fn(),
  tileLayer: vi.fn(),
  heatLayer: vi.fn(),
  remove: vi.fn(),
  removeLayer: vi.fn(),
}));

vi.mock("leaflet", () => ({
  default: {
    map: mocks.map,
    tileLayer: mocks.tileLayer,
    heatLayer: mocks.heatLayer,
  },
}));
vi.mock("leaflet.heat", () => ({}));
vi.mock("@/lib/bounds-utils", () => ({
  getLocalityCenter: () => ({ lat: 42.7, lng: 23.4 }),
}));

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolveResponse) => {
    resolve = resolveResponse;
  });
  return { promise, resolve };
}

function heatmapResponse(messageCount: number) {
  return Response.json({
    points: [[42.7, 23.4]],
    messageCount,
    oldestDate: "2026-01-01T00:00:00.000Z",
  });
}

describe("HistoryMapClient data updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.map.mockReturnValue({
      remove: mocks.remove,
      removeLayer: mocks.removeLayer,
    });
    mocks.tileLayer.mockReturnValue({ addTo: vi.fn() });
    const layer = { addTo: vi.fn() };
    layer.addTo.mockReturnValue(layer);
    mocks.heatLayer.mockReturnValue(layer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an in-flight response to the latest callback without refetching", async () => {
    const response = deferredResponse();
    mocks.fetch.mockReturnValue(response.promise);
    const previousCallback = vi.fn();
    const latestCallback = vi.fn();
    const { rerender } = render(
      <HistoryMapClient onStatsLoaded={previousCallback} />,
    );
    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledOnce();
    });

    rerender(<HistoryMapClient onStatsLoaded={latestCallback} />);
    await act(async () => {
      response.resolve(heatmapResponse(12));
    });

    expect(previousCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledExactlyOnceWith({
      messageCount: 12,
      oldestDate: "2026-01-01T00:00:00.000Z",
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.heatLayer).toHaveBeenCalledOnce();
  });

  it("ignores stale responses after a filter change", async () => {
    const previousResponse = deferredResponse();
    const nextResponse = deferredResponse();
    mocks.fetch.mockReturnValueOnce(previousResponse.promise);
    mocks.fetch.mockReturnValueOnce(nextResponse.promise);
    const onStatsLoaded = vi.fn();
    const { rerender } = render(<HistoryMapClient onStatsLoaded={onStatsLoaded} />);
    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledOnce();
    });

    rerender(
      <HistoryMapClient categories={new Set(["water"])} onStatsLoaded={onStatsLoaded} />,
    );
    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenLastCalledWith("/api/messages/heatmap?categories=water");
    });
    await act(async () => {
      previousResponse.resolve(heatmapResponse(1));
      nextResponse.resolve(heatmapResponse(8));
    });

    expect(onStatsLoaded).toHaveBeenCalledExactlyOnceWith({
      messageCount: 8,
      oldestDate: "2026-01-01T00:00:00.000Z",
    });
    expect(mocks.heatLayer).toHaveBeenCalledOnce();
  });
});
