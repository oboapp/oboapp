import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Interest } from "@/lib/types";
import { getZoneBounds } from "@/lib/zone-bounds";
import { useZoneMapFit } from "./useZoneMapFit";

const interests: Interest[] = [
  {
    id: "home",
    userId: "user",
    coordinates: { lat: 42.7, lng: 23.3 },
    radius: 1000,
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: new Date("2026-11-06T00:00:00Z"),
  },
  {
    id: "work",
    userId: "user",
    coordinates: { lat: 42.6, lng: 23.5 },
    radius: 300,
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: new Date("2026-11-06T00:00:00Z"),
  },
];

function setup() {
  const fitBounds = vi.fn();
  const map = { fitBounds } as unknown as google.maps.Map;
  const props = {
    active: false,
    interests,
    interestsLoaded: true,
    map: map as google.maps.Map | null,
    suspended: false,
    userId: "user",
  };
  const hook = renderHook(useZoneMapFit, { initialProps: props });
  return { ...hook, props, map, fitBounds };
}

describe("useZoneMapFit", () => {
  it("fits full saved circles on entry even with no event data", () => {
    const { rerender, props, fitBounds } = setup();
    expect(fitBounds).not.toHaveBeenCalled();

    rerender({ ...props, active: true });

    expect(fitBounds).toHaveBeenCalledExactlyOnceWith(
      getZoneBounds(interests),
      56,
    );
  });

  it("handles entry directly into My zones", () => {
    const map = { fitBounds: vi.fn() } as unknown as google.maps.Map;
    renderHook(useZoneMapFit, {
      initialProps: {
        active: true,
        interests,
        interestsLoaded: true,
        map,
        suspended: false,
      },
    });
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it.each(["map", "interests"])("waits when %s is the last thing ready", (last) => {
    const { rerender, props, map, fitBounds } = setup();
    rerender({ ...props, active: true, map: null, interestsLoaded: false });
    rerender({
      ...props,
      active: true,
      map: last === "map" ? null : map,
      interestsLoaded: last === "interests" ? false : true,
    });
    expect(fitBounds).not.toHaveBeenCalled();

    rerender({ ...props, active: true });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("preserves manual camera changes through refreshes and zone edits", () => {
    const { rerender, props, map, fitBounds } = setup();
    rerender({ ...props, active: true });
    const panTo = vi.fn();
    const setZoom = vi.fn();
    Object.assign(map, { panTo, setZoom });
    act(() => {
      map.panTo({ lat: 42.75, lng: 23.4 });
      map.setZoom(15);
    });

    rerender({ ...props, active: true, interestsLoaded: false });
    rerender({
      ...props,
      active: true,
      interests: [{ ...interests[0], radius: 200 }],
    });
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(panTo).toHaveBeenCalledTimes(1);
    expect(setZoom).toHaveBeenCalledTimes(1);
  });

  it("fits again on the next entry using the current zones", () => {
    const { rerender, props, fitBounds } = setup();
    rerender({ ...props, active: true });
    rerender(props);
    const updatedInterests = [{ ...interests[0], radius: 200 }];
    rerender({ ...props, active: true, interests: updatedInterests });

    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect(fitBounds).toHaveBeenLastCalledWith(getZoneBounds(updatedInterests), 56);
  });

  it("keeps the camera when no zones exist, including later zone creation", () => {
    const { rerender, props, fitBounds } = setup();
    rerender({ ...props, active: true, interests: [] });
    rerender({ ...props, active: true });
    expect(fitBounds).not.toHaveBeenCalled();

    rerender(props);
    rerender({ ...props, active: true });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("cancels pending entry when leaving before zones finish loading", () => {
    const { rerender, props, fitBounds } = setup();
    rerender({ ...props, active: true, interestsLoaded: false });
    rerender(props);
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("waits for the new user's zones when the account changes", () => {
    const { rerender, props, fitBounds } = setup();
    rerender({ ...props, active: true });
    rerender({ ...props, active: true, userId: "other", interestsLoaded: false });
    expect(fitBounds).toHaveBeenCalledTimes(1);

    const newInterests = [{ ...interests[1], userId: "other" }];
    rerender({ ...props, active: true, userId: "other", interests: newInterests });
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect(fitBounds).toHaveBeenLastCalledWith(getZoneBounds(newInterests), 56);
  });

  it("preserves event or zone-edit navigation while entry is pending", () => {
    const { rerender, props, fitBounds } = setup();
    rerender({ ...props, active: true, interestsLoaded: false });
    rerender({ ...props, active: true, suspended: true });
    rerender({ ...props, active: true });
    expect(fitBounds).not.toHaveBeenCalled();

    rerender(props);
    rerender({ ...props, active: true });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });
});
