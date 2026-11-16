import type { ComponentProps } from "react";
import type { User } from "firebase/auth";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapContainer, { type NearbyLocationState } from "./MapContainer";

const mocks = vi.hoisted(() => ({
  centerMap: vi.fn(),
  getCurrentPosition: vi.fn(),
  queryPermission: vi.fn(),
  fitBounds: vi.fn(),
  getBounds: vi.fn(),
  getZoom: vi.fn(),
  auth: { user: null as User | null, loading: true, guestAuthUnavailable: false },
  onboardingOptions: vi.fn(),
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
  useAuth: () => mocks.auth,
}));
vi.mock("@/lib/hooks/useOnboardingFlow", () => ({
  useOnboardingFlow: (options: unknown) => {
    mocks.onboardingOptions(options);
    return {
      state: "loading",
      handlePermissionResult: vi.fn(),
      handleDismiss: vi.fn(),
      handleRestart: vi.fn(),
    };
  },
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
    mocks.auth.user = null;
    mocks.auth.loading = true;
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for auth and interests before completing an unauthenticated subscription check", () => {
    const { rerender } = render(<MapContainer {...defaultProps} interestsLoaded={false} />);
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: false,
      hasSubscriptions: false,
    }));
    mocks.auth.loading = false;
    rerender(<MapContainer {...defaultProps} interestsLoaded={false} />);
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: false,
    }));
    rerender(<MapContainer {...defaultProps} />);
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: true,
      hasSubscriptions: false,
    }));
  });

  it("ignores a subscription response after the signed-in user changes", async () => {
    const responses: ((response: Response) => void)[] = [];
    const fetchSubscriptions = vi.fn(() => {
      return new Promise<Response>((resolve) => {
        responses.push(resolve);
      });
    });
    vi.stubGlobal("fetch", fetchSubscriptions);
    mocks.auth.loading = false;
    mocks.auth.user = { uid: "previous-user", getIdToken: vi.fn().mockResolvedValue("first") } as unknown as User;
    const { rerender } = render(<MapContainer {...defaultProps} />);
    await waitFor(() => {
      expect(responses).toHaveLength(1);
    });
    mocks.auth.user = { uid: "current-user", getIdToken: vi.fn().mockResolvedValue("second") } as unknown as User;
    rerender(<MapContainer {...defaultProps} />);
    await waitFor(() => {
      expect(responses).toHaveLength(2);
    });
    await act(async () => {
      responses[0](Response.json([{ token: "old-device" }]));
    });
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: false,
      hasSubscriptions: false,
    }));
    await act(async () => {
      responses[1](Response.json([]));
    });
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: true,
      hasSubscriptions: false,
    }));
  });

  it.each(["http", "network"])(
    "keeps the same user's known subscription status after a failed %s refresh",
    async (failure) => {
      const fetchSubscriptions = vi.fn().mockResolvedValueOnce(
        Response.json([{ token: "known-device" }]),
      );
      vi.stubGlobal("fetch", fetchSubscriptions);
      mocks.auth.loading = false;
      mocks.auth.user = {
        uid: "current-user",
        getIdToken: vi.fn().mockResolvedValue("first"),
      } as unknown as User;
      const { rerender } = render(<MapContainer {...defaultProps} />);
      await waitFor(() => {
        expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
          subscriptionsLoaded: true,
          hasSubscriptions: true,
        }));
      });

      if (failure === "http") {
        fetchSubscriptions.mockResolvedValueOnce(new Response(null, { status: 503 }));
      } else {
        fetchSubscriptions.mockRejectedValueOnce(new Error("Network unavailable"));
      }
      mocks.auth.user = {
        uid: "current-user",
        getIdToken: vi.fn().mockResolvedValue("refreshed"),
      } as unknown as User;
      await act(async () => {
        rerender(<MapContainer {...defaultProps} />);
      });

      expect(fetchSubscriptions).toHaveBeenCalledTimes(2);
      expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
        subscriptionsLoaded: true,
        hasSubscriptions: true,
      }));
    },
  );

  it("uses no subscriptions after a different user's initial check fails", async () => {
    const fetchSubscriptions = vi.fn()
      .mockResolvedValueOnce(Response.json([{ token: "previous-device" }]))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchSubscriptions);
    mocks.auth.loading = false;
    mocks.auth.user = {
      uid: "previous-user",
      getIdToken: vi.fn().mockResolvedValue("first"),
    } as unknown as User;
    const { rerender } = render(<MapContainer {...defaultProps} />);
    await waitFor(() => {
      expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
        subscriptionsLoaded: true,
        hasSubscriptions: true,
      }));
    });
    mocks.auth.user = {
      uid: "current-user",
      getIdToken: vi.fn().mockResolvedValue("second"),
    } as unknown as User;
    await act(async () => {
      rerender(<MapContainer {...defaultProps} />);
    });

    expect(fetchSubscriptions).toHaveBeenCalledTimes(2);
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: true,
      hasSubscriptions: false,
    }));
  });

  it("clears known subscriptions after logout before the same account signs in again", async () => {
    let resolveResponse!: (response: Response) => void;
    const loginResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchSubscriptions = vi.fn()
      .mockResolvedValueOnce(Response.json([{ token: "previous-session-device" }]))
      .mockReturnValueOnce(loginResponse);
    vi.stubGlobal("fetch", fetchSubscriptions);
    mocks.auth.loading = false;
    mocks.auth.user = {
      uid: "current-user",
      getIdToken: vi.fn().mockResolvedValue("first-session"),
    } as unknown as User;
    const { rerender } = render(<MapContainer {...defaultProps} />);
    await waitFor(() => {
      expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
        subscriptionsLoaded: true,
        hasSubscriptions: true,
      }));
    });

    mocks.auth.user = null;
    rerender(<MapContainer {...defaultProps} />);
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: true,
      hasSubscriptions: false,
    }));
    mocks.auth.user = {
      uid: "current-user",
      getIdToken: vi.fn().mockResolvedValue("next-session"),
    } as unknown as User;
    rerender(<MapContainer {...defaultProps} />);
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: false,
      hasSubscriptions: false,
    }));
    await act(async () => {
      resolveResponse(new Response(null, { status: 503 }));
    });

    expect(fetchSubscriptions).toHaveBeenCalledTimes(2);
    expect(mocks.onboardingOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      subscriptionsLoaded: true,
      hasSubscriptions: false,
    }));
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

  it("shows loading when reentering Nearby without a new explicit request id", async () => {
    successfulPosition();
    const { rerender } = render(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    readyMap();
    await waitFor(() => {
      expect(locationState?.status).toBe("ready");
    });
    rerender(<MapContainer {...defaultProps} navigationMode="zones" />);

    let respond: PositionCallback | undefined;
    mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      respond = success;
    });
    rerender(
      <MapContainer {...defaultProps} navigationMode="nearby" navigationSource="manual" />,
    );
    expect(locationState?.status).toBe("loading");
    expect(screen.getByLabelText("Location tracking")).toHaveTextContent("disabled");
    await act(async () => {
      respond?.({ coords: { latitude: 42.7, longitude: 23.4 } } as GeolocationPosition);
    });

    expect(locationState?.status).toBe("ready");
    expect(mocks.centerMap).toHaveBeenCalledTimes(2);
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
