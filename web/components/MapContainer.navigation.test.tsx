import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapContainer, { type NearbyLocationState } from "./MapContainer";

const mocks = vi.hoisted(() => ({
  centerMap: vi.fn(),
  getCurrentPosition: vi.fn(),
  queryPermission: vi.fn(),
  fitBounds: vi.fn(),
  getBounds: vi.fn(),
  getZoom: vi.fn(),
}));
const cityBounds = { south: 42.605, west: 23.188, north: 42.83, east: 23.528 };
let locationState: NearbyLocationState | null = null;

vi.mock("@/components/MapComponent", () => ({
  default: function MapComponent({
    onMapReady,
    shouldTrackLocation,
  }: {
    onMapReady: (centerMap: typeof mocks.centerMap, map: google.maps.Map) => void;
    shouldTrackLocation: boolean;
  }) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            onMapReady(mocks.centerMap, {
              fitBounds: mocks.fitBounds,
              getBounds: mocks.getBounds,
              getZoom: mocks.getZoom,
            } as unknown as google.maps.Map);
          }}
        >
          Map ready
        </button>
        <output aria-label="Location tracking">
          {shouldTrackLocation ? "enabled" : "disabled"}
        </output>
      </>
    );
  },
}));

vi.mock("@/lib/bounds-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bounds-utils")>()),
  getLocality: () => "bg.sofia",
  getLocalityBounds: () => cityBounds,
  getLocalityCenter: () => ({ lat: 42.6977, lng: 23.3219 }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: null, loading: true, guestAuthUnavailable: false }),
}));
vi.mock("@/lib/hooks/useOnboardingFlow", () => ({
  useOnboardingFlow: () => ({
    state: "loading",
    handlePermissionResult: vi.fn(),
    handleDismiss: vi.fn(),
    handleRestart: vi.fn(),
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const defaultProps: ComponentProps<typeof MapContainer> = {
  messages: [],
  interests: [],
  interestsLoaded: true,
  user: null,
  targetMode: { active: false },
  onFeatureClick: vi.fn(),
  onMapReady: vi.fn(),
  onBoundsChanged: vi.fn(),
  onSaveInterest: vi.fn(),
  onCancelTargetMode: vi.fn(),
  onStartAddInterest: vi.fn(),
  onLocationStateChange: (state) => {
    locationState = state;
  },
  onOnboardingStateChange: vi.fn(),
};

function readyMap() {
  fireEvent.click(screen.getByRole("button", { name: "Map ready" }));
}

function successfulPosition(lat = 42.7, lng = 23.4) {
  mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
    success({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition);
  });
}

describe("MapContainer tab navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationState = null;
    mocks.getCurrentPosition.mockReset();
    mocks.queryPermission.mockReset().mockResolvedValue({ state: "granted" });
    mocks.getBounds.mockReturnValue({
      getNorthEast: () => ({ lat: () => 42.71, lng: () => 23.41 }),
      getSouthWest: () => ({ lat: () => 42.69, lng: () => 23.39 }),
    });
    mocks.getZoom.mockReturnValue(17);
    localStorage.clear();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: mocks.getCurrentPosition },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: mocks.queryPermission },
    });
  });

  it("opens All at the configured city and never locates from old consent", () => {
    localStorage.setItem("geolocationPermissionGranted", "true");
    render(<MapContainer {...defaultProps} />);
    readyMap();
    expect(mocks.fitBounds).toHaveBeenCalledExactlyOnceWith(cityBounds, 32);
    expect(mocks.getCurrentPosition).not.toHaveBeenCalled();
    expect(mocks.queryPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", {
      name: "Покажи моето местоположение",
    })).not.toBeInTheDocument();
  });

  it("waits for the home decision before opening initial Nearby once", async () => {
    successfulPosition();
    const { rerender } = render(
      <MapContainer {...defaultProps} navigationMode="nearby" initialNavigationReady={false} />,
    );
    readyMap();
    expect(mocks.getCurrentPosition).not.toHaveBeenCalled();
    rerender(<MapContainer {...defaultProps} navigationMode="nearby" />);
    await waitFor(() => {
      expect(mocks.centerMap).toHaveBeenCalledExactlyOnceWith(42.7, 23.4, 17, {
        animate: false,
      });
      expect(locationState?.status).toBe("ready");
    });
    rerender(<MapContainer {...defaultProps} navigationMode="nearby" interests={[]} />);
    expect(mocks.getCurrentPosition).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Location tracking")).toHaveTextContent("enabled");
  });

  it("requests Nearby directly from an explicit tab action", async () => {
    successfulPosition();
    mocks.queryPermission.mockResolvedValue({ state: "prompt" });
    const { rerender } = render(<MapContainer {...defaultProps} />);
    readyMap();
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" navigationRequestId={1} />,
    );
    await waitFor(() => {
      expect(mocks.centerMap).toHaveBeenCalledExactlyOnceWith(42.7, 23.4, 17, {
        animate: false,
      });
    });
    expect(mocks.queryPermission).not.toHaveBeenCalled();
    expect(localStorage.getItem("geolocationPermissionGranted")).toBeNull();
  });

  it.each(["prompt", "denied"])(
    "keeps initial Nearby silent for %s permission and lets the inline action retry",
    async (permission) => {
      successfulPosition();
      mocks.queryPermission.mockResolvedValue({ state: permission });
      render(<MapContainer {...defaultProps} navigationMode="nearby" />);
      readyMap();
      await waitFor(() => {
        expect(locationState?.status).toBe("permission-required");
      });
      expect(mocks.getCurrentPosition).not.toHaveBeenCalled();
      expect(mocks.fitBounds).toHaveBeenCalledExactlyOnceWith(cityBounds, 32);
      act(() => {
        locationState?.retry();
      });
      await waitFor(() => {
        expect(locationState?.status).toBe("ready");
      });
      expect(mocks.getCurrentPosition).toHaveBeenCalledOnce();
      expect(mocks.queryPermission).toHaveBeenCalledOnce();
    },
  );

  it("reports a location failure inline and falls back to the city", async () => {
    mocks.getCurrentPosition.mockImplementation((_success, failure) => {
      failure({ code: 3 });
    });
    render(<MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />);
    readyMap();
    await waitFor(() => {
      expect(locationState?.status).toBe("error");
      expect(locationState?.message).toContain("Изтече времето");
    });
    expect(mocks.fitBounds).toHaveBeenCalledExactlyOnceWith(cityBounds, 32);
    expect(screen.getByLabelText("Location tracking")).toHaveTextContent("disabled");
  });

  it("does not center outside the supported area and allows another attempt", async () => {
    successfulPosition(43.1, 25.2);
    render(<MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />);
    readyMap();
    await waitFor(() => {
      expect(locationState?.status).toBe("error");
      expect(locationState?.message).toContain("извън поддържаната карта");
    });
    expect(mocks.centerMap).not.toHaveBeenCalled();
    expect(mocks.fitBounds).toHaveBeenCalledOnce();
    successfulPosition();
    act(() => {
      locationState?.retry();
    });
    await waitFor(() => {
      expect(locationState?.status).toBe("ready");
    });
    expect(mocks.centerMap).toHaveBeenCalledOnce();
  });

  it.each(["zones", "all"] as const)(
    "ignores a late Nearby result after switching to %s",
    async (nextMode) => {
      let respond: PositionCallback | undefined;
      mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
        respond = success;
      });
      const { rerender } = render(
        <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
      );
      readyMap();
      expect(locationState?.status).toBe("loading");
      rerender(<MapContainer {...defaultProps} navigationMode={nextMode} navigationRequestId={1} />);
      await act(async () => {
        respond?.({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
      });
      expect(mocks.centerMap).not.toHaveBeenCalled();
      expect(locationState?.status).toBe("idle");
      expect(screen.getByLabelText("Location tracking")).toHaveTextContent("disabled");
    },
  );

  it("cancels a pending permission check when an explicit event takes the camera", async () => {
    let respond: ((permission: { state: string }) => void) | undefined;
    mocks.queryPermission.mockImplementation(() => {
      return new Promise((resolve) => {
        respond = resolve;
      });
    });
    const { rerender } = render(<MapContainer {...defaultProps} navigationMode="nearby" />);
    readyMap();
    rerender(<MapContainer {...defaultProps} navigationMode="nearby" navigationSuspended />);
    await act(async () => {
      respond?.({ state: "granted" });
    });
    expect(mocks.getCurrentPosition).not.toHaveBeenCalled();
    expect(mocks.fitBounds).not.toHaveBeenCalled();
    expect(locationState?.status).toBe("permission-required");
  });

  it("locates once per explicit Nearby request and stops tracking in All", async () => {
    successfulPosition();
    const { rerender } = render(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    readyMap();
    await waitFor(() => {
      expect(locationState?.status).toBe("ready");
    });
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" navigationRequestId={1} />,
    );
    await waitFor(() => {
      expect(mocks.getCurrentPosition).toHaveBeenCalledTimes(2);
      expect(locationState?.status).toBe("ready");
    });
    rerender(<MapContainer {...defaultProps} navigationRequestId={2} />);
    expect(screen.getByLabelText("Location tracking")).toHaveTextContent("disabled");
    expect(mocks.fitBounds).toHaveBeenCalledOnce();
  });

  it("preserves direct-link navigation until a later explicit tab request", () => {
    const { rerender } = render(<MapContainer {...defaultProps} navigationSuspended />);
    readyMap();
    expect(mocks.fitBounds).not.toHaveBeenCalled();
    rerender(<MapContainer {...defaultProps} />);
    expect(mocks.fitBounds).not.toHaveBeenCalled();
    rerender(<MapContainer {...defaultProps} navigationSource="manual" navigationRequestId={1} />);
    expect(mocks.fitBounds).toHaveBeenCalledExactlyOnceWith(cityBounds, 32);
  });

  it("delivers fresh viewport bounds after each fix even when the camera stays in place", async () => {
    let respond: PositionCallback | undefined;
    mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      respond = success;
    });
    const onBoundsChanged = vi.fn();
    const { rerender } = render(
      <MapContainer
        {...defaultProps}
        navigationMode="nearby"
        navigationSource="manual"
        onBoundsChanged={onBoundsChanged}
      />,
    );
    readyMap();
    expect(onBoundsChanged).not.toHaveBeenCalled();

    await act(async () => {
      respond?.({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    });
    const expectedViewport = {
      north: 42.71,
      south: 42.69,
      east: 23.41,
      west: 23.39,
      zoom: 17,
    };
    expect(onBoundsChanged).toHaveBeenCalledExactlyOnceWith(expectedViewport);
    expect(mocks.centerMap).toHaveBeenLastCalledWith(42.7, 23.4, 17, { animate: false });

    rerender(
      <MapContainer
        {...defaultProps}
        navigationMode="nearby"
        navigationSource="manual"
        navigationRequestId={1}
        onBoundsChanged={onBoundsChanged}
      />,
    );
    expect(onBoundsChanged).toHaveBeenCalledTimes(1);
    await act(async () => {
      respond?.({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    });
    expect(onBoundsChanged).toHaveBeenCalledTimes(2);
    expect(onBoundsChanged).toHaveBeenLastCalledWith(expectedViewport);
    expect(locationState?.status).toBe("ready");
  });

  it("lets manual tab entry take over a URL-based initial center", () => {
    const initialMapCenter = { lat: 42.7, lng: 23.4 };
    const { rerender } = render(<MapContainer {...defaultProps} initialMapCenter={initialMapCenter} />);
    readyMap();
    expect(mocks.fitBounds).not.toHaveBeenCalled();
    rerender(
      <MapContainer {...defaultProps} initialMapCenter={initialMapCenter} navigationSource="manual" navigationRequestId={1} />,
    );
    expect(mocks.fitBounds).toHaveBeenCalledOnce();
  });

  it("stops a pending request when zone placement starts", async () => {
    let respond: PositionCallback | undefined;
    mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      respond = success;
    });
    const { rerender } = render(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    readyMap();
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" targetMode={{ active: true }} />,
    );
    await act(async () => {
      respond?.({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    });
    expect(mocks.centerMap).not.toHaveBeenCalled();
    expect(mocks.fitBounds).not.toHaveBeenCalled();
    expect(locationState?.status).toBe("permission-required");
  });

  it("keeps ready Nearby data while event details own the camera", async () => {
    successfulPosition();
    const { rerender } = render(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    readyMap();
    await waitFor(() => {
      expect(locationState?.status).toBe("ready");
    });
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" navigationSuspended />,
    );
    expect(locationState?.status).toBe("ready");
    expect(screen.getByLabelText("Location tracking")).toHaveTextContent("disabled");
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    expect(locationState?.status).toBe("ready");
    expect(mocks.getCurrentPosition).toHaveBeenCalledOnce();
    expect(mocks.centerMap).toHaveBeenCalledOnce();
  });

  it("offers an explicit retry after canceling zone placement during a pending fix", async () => {
    const callbacks: PositionCallback[] = [];
    mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      callbacks.push(success);
    });
    const { rerender } = render(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    readyMap();
    expect(locationState?.status).toBe("loading");
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" targetMode={{ active: true }} />,
    );
    expect(locationState?.status).toBe("permission-required");
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    expect(locationState?.status).toBe("permission-required");
    expect(mocks.getCurrentPosition).toHaveBeenCalledOnce();

    act(() => {
      locationState?.retry();
    });
    expect(mocks.getCurrentPosition).toHaveBeenCalledTimes(2);
    await act(async () => {
      callbacks[0]({ coords: { latitude: 42.6, longitude: 23.3 } } as GeolocationPosition);
      callbacks[1]({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    });
    expect(locationState?.status).toBe("ready");
    expect(mocks.centerMap).toHaveBeenCalledExactlyOnceWith(42.7, 23.4, 17, { animate: false });
  });
});
