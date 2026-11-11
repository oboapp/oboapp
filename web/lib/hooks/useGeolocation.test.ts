import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGeolocation } from "./useGeolocation";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const getCurrentPosition = vi.fn();
const queryPermission = vi.fn();

function successfulPosition(lat = 42.6977, lng = 23.3219) {
  getCurrentPosition.mockImplementation((success: PositionCallback) => {
    success({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition);
  });
}

describe("useGeolocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentPosition.mockReset();
    queryPermission.mockReset().mockResolvedValue({ state: "granted" });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: queryPermission },
    });
    localStorage.clear();
  });

  it("requests location directly for an explicit action without saving a preference", async () => {
    successfulPosition();
    queryPermission.mockResolvedValue({ state: "prompt" });
    const setItem = vi.spyOn(localStorage, "setItem");
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    const onPosition = vi.fn();

    expect(await result.current.locate(onPosition, { automatic: false })).toEqual({
      status: "ready",
      message: null,
    });

    expect(queryPermission).not.toHaveBeenCalled();
    expect(onPosition).toHaveBeenCalledExactlyOnceWith({ lat: 42.6977, lng: 23.3219 });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("checks current browser permission before automatically locating", async () => {
    successfulPosition();
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    const onPosition = vi.fn();

    expect(await result.current.locate(onPosition, { automatic: true })).toEqual({
      status: "ready",
      message: null,
    });
    expect(queryPermission).toHaveBeenCalledExactlyOnceWith({ name: "geolocation" });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it.each(["prompt", "denied"])(
    "does not request automatic location when permission is %s, even with legacy consent",
    async (permission) => {
      localStorage.setItem("geolocationPermissionGranted", "true");
      queryPermission.mockResolvedValue({ state: permission });
      const { result } = renderHook(() => useGeolocation({ enabled: true }));

      expect((await result.current.locate(vi.fn(), { automatic: true })).status).toBe(
        "permission-required",
      );
      expect(getCurrentPosition).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "throws"])(
    "keeps startup permission silent when the permissions API %s",
    async (availability) => {
      if (availability === "missing") {
        Object.defineProperty(navigator, "permissions", {
          configurable: true,
          value: undefined,
        });
      } else {
        queryPermission.mockRejectedValue(new Error("Unsupported permission query"));
      }
      const { result } = renderHook(() => useGeolocation({ enabled: true }));

      expect((await result.current.locate(vi.fn(), { automatic: true })).status).toBe(
        "permission-required",
      );
      expect(getCurrentPosition).not.toHaveBeenCalled();
    },
  );

  it("does not request location while disabled", async () => {
    const { result } = renderHook(() => useGeolocation({ enabled: false }));

    expect((await result.current.locate(vi.fn(), { automatic: false })).status).toBe(
      "canceled",
    );
    expect(queryPermission).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("ignores an older position after leaving and re-entering the view", async () => {
    let respond: PositionCallback | undefined;
    getCurrentPosition.mockImplementation((success: PositionCallback) => {
      respond = success;
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useGeolocation({ enabled }),
      { initialProps: { enabled: true } },
    );
    const onPosition = vi.fn();
    const pending = result.current.locate(onPosition, { automatic: false });
    rerender({ enabled: false });
    rerender({ enabled: true });

    respond?.({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    expect((await pending).status).toBe("canceled");
    expect(onPosition).not.toHaveBeenCalled();
  });

  it("does not start a position request after a canceled permission query completes", async () => {
    let respond: ((permission: { state: string }) => void) | undefined;
    queryPermission.mockImplementation(() => {
      return new Promise((resolve) => {
        respond = resolve;
      });
    });
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    const pending = result.current.locate(vi.fn(), { automatic: true });
    result.current.cancel();
    respond?.({ state: "granted" });

    expect((await pending).status).toBe("canceled");
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("allows the latest explicit request to replace a pending request", async () => {
    const callbacks: PositionCallback[] = [];
    getCurrentPosition.mockImplementation((success: PositionCallback) => {
      callbacks.push(success);
    });
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    const onPosition = vi.fn();
    const first = result.current.locate(onPosition, { automatic: false });
    const second = result.current.locate(onPosition, { automatic: false });

    callbacks[0]({ coords: { latitude: 42.6, longitude: 23.3 } } as GeolocationPosition);
    expect((await first).status).toBe("canceled");
    callbacks[1]({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    expect((await second).status).toBe("ready");
    expect(onPosition).toHaveBeenCalledExactlyOnceWith({ lat: 42.7, lng: 23.4 });
  });

  it("ignores a late position after unmount", async () => {
    let respond: PositionCallback | undefined;
    getCurrentPosition.mockImplementation((success: PositionCallback) => {
      respond = success;
    });
    const { result, unmount } = renderHook(() => useGeolocation({ enabled: true }));
    const onPosition = vi.fn();
    const pending = result.current.locate(onPosition, { automatic: false });
    unmount();

    respond?.({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    expect((await pending).status).toBe("canceled");
    expect(onPosition).not.toHaveBeenCalled();
  });

  it.each([
    [1, "Достъпът"],
    [2, "не може"],
    [3, "Изтече времето"],
  ])("returns useful inline error text for browser error %s", async (code, text) => {
    getCurrentPosition.mockImplementation((_success, failure) => {
      failure({ code });
    });
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    const response = await result.current.locate(vi.fn(), { automatic: false });

    expect(response.status).toBe("error");
    expect(response.message).toContain(text);
  });

  it("returns a validation error without reporting success", async () => {
    successfulPosition();
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    const response = await result.current.locate(() => {
      throw new Error("Outside the supported map");
    }, { automatic: false });

    expect(response).toEqual({ status: "error", message: "Outside the supported map" });
  });

  it("reports unsupported geolocation without requesting permission", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useGeolocation({ enabled: true }));

    await act(async () => {
      expect((await result.current.locate(vi.fn(), { automatic: true })).status).toBe(
        "error",
      );
    });
    expect(queryPermission).not.toHaveBeenCalled();
  });
});
