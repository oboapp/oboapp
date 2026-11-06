import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGeolocationPrompt } from "./useGeolocationPrompt";

const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

// Mock the analytics
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

// Mock navigator.geolocation
const mockGetCurrentPosition = vi.fn();
const mockGeolocation = {
  getCurrentPosition: mockGetCurrentPosition,
};

Object.defineProperty(navigator, "geolocation", {
  value: mockGeolocation,
  writable: true,
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("useGeolocationPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentPosition.mockReset();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it("should initialize with correct default state", () => {
    const { result } = renderHook(() => useGeolocationPrompt());

    expect(result.current.showPrompt).toBe(false);
    expect(result.current.isLocating).toBe(false);
    expect(typeof result.current.requestGeolocation).toBe("function");
    expect(typeof result.current.autoCenter).toBe("function");
    expect(typeof result.current.hidePrompt).toBe("function");
  });

  it("should show prompt when no cached permission exists", async () => {
    const { result } = renderHook(() => useGeolocationPrompt());
    const mockCenterMap = vi.fn();

    localStorageMock.getItem.mockReturnValue("false");

    await act(async () => {
      result.current.requestGeolocation(mockCenterMap);
    });

    expect(result.current.showPrompt).toBe(true);
  });

  it("should directly get location when permission is cached", async () => {
    const { result } = renderHook(() => useGeolocationPrompt());
    const mockCenterMap = vi.fn();

    localStorageMock.getItem.mockReturnValue("true");
    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 42.6977,
          longitude: 23.3219,
        },
      });
    });

    await act(async () => {
      await result.current.requestGeolocation(mockCenterMap);
    });

    expect(mockCenterMap).toHaveBeenCalledWith(42.6977, 23.3219, 17, {
      animate: true,
    });
    expect(result.current.showPrompt).toBe(false);
  });

  it("should handle geolocation errors gracefully", async () => {
    const { result } = renderHook(() => useGeolocationPrompt());
    const mockCenterMap = vi.fn();

    localStorageMock.getItem.mockReturnValue("true");
    mockGetCurrentPosition.mockImplementation((success, error) => {
      error({
        code: 1, // PERMISSION_DENIED
        message: "Permission denied",
      });
    });

    await act(async () => {
      try {
        await result.current.requestGeolocation(mockCenterMap);
      } catch {
        // Expected to throw
      }
    });

    expect(toastMock.error).toHaveBeenCalled();
    expect(mockCenterMap).not.toHaveBeenCalled();
  });

  it("should hide prompt when hidePrompt is called", () => {
    const { result } = renderHook(() => useGeolocationPrompt());

    act(() => {
      // Simulate showing prompt
      result.current.requestGeolocation(vi.fn());
    });

    act(() => {
      result.current.hidePrompt();
    });

    expect(result.current.showPrompt).toBe(false);
  });

  it("should auto-center when permission is cached", async () => {
    const { result } = renderHook(() => useGeolocationPrompt());
    const mockCenterMap = vi.fn();

    localStorageMock.getItem.mockReturnValue("true");
    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 42.6977,
          longitude: 23.3219,
        },
      });
    });

    await act(async () => {
      const centered = await result.current.autoCenter(mockCenterMap);
      expect(centered).toBe(true);
    });

    expect(mockCenterMap).toHaveBeenCalledWith(42.6977, 23.3219, 17, {
      animate: false,
    });
    expect(result.current.showPrompt).toBe(false);
  });

  it("should not auto-center when permission is not cached", async () => {
    const { result } = renderHook(() => useGeolocationPrompt());
    const mockCenterMap = vi.fn();

    localStorageMock.getItem.mockReturnValue("false");

    await act(async () => {
      const centered = await result.current.autoCenter(mockCenterMap);
      expect(centered).toBe(false);
    });

    expect(mockCenterMap).not.toHaveBeenCalled();
    expect(result.current.showPrompt).toBe(false);
  });

  it("does not request automatic location when automatic centering is disabled", async () => {
    localStorageMock.getItem.mockReturnValue("true");
    const { result } = renderHook(() =>
      useGeolocationPrompt({ automaticCenterEnabled: false }),
    );
    const centerMap = vi.fn();

    await act(async () => {
      expect(await result.current.autoCenter(centerMap)).toBe(false);
    });

    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    expect(centerMap).not.toHaveBeenCalled();
    expect(result.current.isLocating).toBe(false);
  });

  it("ignores an automatic location result after centering is disabled and reenabled", async () => {
    localStorageMock.getItem.mockReturnValue("true");
    let resolvePosition: PositionCallback | undefined;
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      resolvePosition = success;
    });
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useGeolocationPrompt({ automaticCenterEnabled: enabled }),
      { initialProps: { enabled: true } },
    );
    const centerMap = vi.fn();
    let pendingCenter: Promise<boolean> | undefined;

    act(() => {
      pendingCenter = result.current.autoCenter(centerMap);
    });
    expect(result.current.isLocating).toBe(true);

    rerender({ enabled: false });
    rerender({ enabled: true });

    await act(async () => {
      resolvePosition?.({
        coords: { latitude: 42.6977, longitude: 23.3219 },
      } as GeolocationPosition);
      expect(await pendingCenter).toBe(false);
    });

    expect(centerMap).not.toHaveBeenCalled();
    expect(result.current.isLocating).toBe(false);
  });

  it("allows explicit location while automatic centering is disabled", async () => {
    localStorageMock.getItem.mockReturnValue("true");
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: 42.6977, longitude: 23.3219 },
      } as GeolocationPosition);
    });
    const { result } = renderHook(() =>
      useGeolocationPrompt({ automaticCenterEnabled: false }),
    );
    const centerMap = vi.fn();

    await act(async () => {
      await result.current.requestGeolocation(centerMap);
    });

    expect(centerMap).toHaveBeenCalledWith(42.6977, 23.3219, 17, {
      animate: true,
    });
  });

  it.each([true, false])(
    "ignores a late explicit location after changing views with cached permission %s",
    async (hasCachedPermission) => {
      localStorageMock.getItem.mockReturnValue(
        hasCachedPermission ? "true" : "false",
      );
      let resolvePosition: PositionCallback | undefined;
      mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
        resolvePosition = success;
      });
      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useGeolocationPrompt({ automaticCenterEnabled: enabled }),
        { initialProps: { enabled: true } },
      );
      const centerMap = vi.fn();
      let pendingLocation: Promise<void> | undefined;

      act(() => {
        pendingLocation = result.current.requestGeolocation(centerMap);
      });
      if (!hasCachedPermission) {
        act(() => {
          result.current.onAccept();
        });
      }
      rerender({ enabled: false });

      await act(async () => {
        resolvePosition?.({
          coords: { latitude: 42.6977, longitude: 23.3219 },
        } as GeolocationPosition);
        await pendingLocation;
      });

      expect(centerMap).not.toHaveBeenCalled();
      expect(result.current.isLocating).toBe(false);
    },
  );

  it("gives an explicit location request priority over an older automatic request", async () => {
    localStorageMock.getItem.mockReturnValue("true");
    const positionCallbacks: PositionCallback[] = [];
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      positionCallbacks.push(success);
    });
    const { result } = renderHook(() => useGeolocationPrompt());
    const centerMap = vi.fn();
    let automaticRequest: Promise<boolean> | undefined;
    let explicitRequest: Promise<void> | undefined;

    act(() => {
      automaticRequest = result.current.autoCenter(centerMap);
      explicitRequest = result.current.requestGeolocation(centerMap);
    });

    await act(async () => {
      positionCallbacks[0]({
        coords: { latitude: 42.6977, longitude: 23.3219 },
      } as GeolocationPosition);
      expect(await automaticRequest).toBe(false);
    });

    expect(result.current.isLocating).toBe(true);
    expect(centerMap).not.toHaveBeenCalled();

    await act(async () => {
      positionCallbacks[1]({
        coords: { latitude: 42.7, longitude: 23.4 },
      } as GeolocationPosition);
      await explicitRequest;
    });

    expect(centerMap).toHaveBeenCalledExactlyOnceWith(42.7, 23.4, 17, {
      animate: true,
    });
    expect(result.current.isLocating).toBe(false);
  });

  it("ignores an automatic location result after unmount", async () => {
    localStorageMock.getItem.mockReturnValue("true");
    let resolvePosition: PositionCallback | undefined;
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      resolvePosition = success;
    });
    const { result, unmount } = renderHook(() => useGeolocationPrompt());
    const centerMap = vi.fn();
    let pendingCenter: Promise<boolean> | undefined;

    act(() => {
      pendingCenter = result.current.autoCenter(centerMap);
    });
    unmount();

    await act(async () => {
      resolvePosition?.({
        coords: { latitude: 42.6977, longitude: 23.3219 },
      } as GeolocationPosition);
      expect(await pendingCenter).toBe(false);
    });

    expect(centerMap).not.toHaveBeenCalled();
  });

  it("should handle auto-center geolocation errors silently", async () => {
    const { result } = renderHook(() => useGeolocationPrompt());
    const mockCenterMap = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    localStorageMock.getItem.mockReturnValue("true");
    mockGetCurrentPosition.mockImplementation((success, error) => {
      error({
        code: 1, // PERMISSION_DENIED
        message: "Permission denied",
      });
    });

    await act(async () => {
      const centered = await result.current.autoCenter(mockCenterMap);
      expect(centered).toBe(false);
    });

    expect(consoleSpy).toHaveBeenCalled();
    expect(mockCenterMap).not.toHaveBeenCalled();
    // No toast should be shown for auto-center
    expect(toastMock.error).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
