import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapContainer from "./MapContainer";

const mocks = vi.hoisted(() => ({
  centerMap: vi.fn(),
  getCurrentPosition: vi.fn(),
}));

vi.mock("@/components/MapComponent", () => ({
  default: function MapComponent({
    onMapReady,
    shouldTrackLocation,
  }: {
    onMapReady: (centerMap: typeof mocks.centerMap, map: null) => void;
    shouldTrackLocation: boolean;
  }) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            onMapReady(mocks.centerMap, null);
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

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: null,
    loading: true,
    guestAuthUnavailable: false,
  }),
}));

vi.mock("@/lib/hooks/useOnboardingFlow", () => ({
  useOnboardingFlow: () => ({
    state: "loading",
    handlePermissionResult: vi.fn(),
    handleDismiss: vi.fn(),
    handleRestart: vi.fn(),
  }),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

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
  onGeolocationPromptChange: vi.fn(),
  onOnboardingStateChange: vi.fn(),
};

describe("MapContainer automatic location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentPosition.mockReset();
    localStorage.clear();
    localStorage.setItem("geolocationPermissionGranted", "true");
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: mocks.getCurrentPosition },
      configurable: true,
    });
  });

  it("keeps explicit Locate usable when automatic centering is disabled", async () => {
    mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: 42.7, longitude: 23.4 },
      } as GeolocationPosition);
    });
    render(<MapContainer {...defaultProps} automaticCenterEnabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Map ready" }));
    expect(mocks.getCurrentPosition).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Покажи моето местоположение" }),
    );

    await waitFor(() => {
      expect(mocks.centerMap).toHaveBeenCalledExactlyOnceWith(42.7, 23.4, 17, {
        animate: true,
      });
      expect(screen.getByLabelText("Location tracking")).toHaveTextContent(
        "enabled",
      );
    });
  });

  it("discards a late automatic location after entering another view", async () => {
    let resolvePosition: PositionCallback | undefined;
    mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      resolvePosition = success;
    });
    const { rerender } = render(<MapContainer {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Map ready" }));
    expect(mocks.getCurrentPosition).toHaveBeenCalledOnce();
    rerender(<MapContainer {...defaultProps} automaticCenterEnabled={false} />);

    await act(async () => {
      resolvePosition?.({
        coords: { latitude: 42.7, longitude: 23.4 },
      } as GeolocationPosition);
    });

    expect(mocks.centerMap).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Location tracking")).toHaveTextContent(
      "disabled",
    );
  });

  it("discards a late automatic location when URL coordinates become available", async () => {
    let resolvePosition: PositionCallback | undefined;
    mocks.getCurrentPosition.mockImplementation((success: PositionCallback) => {
      resolvePosition = success;
    });
    const { rerender } = render(<MapContainer {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Map ready" }));
    rerender(
      <MapContainer
        {...defaultProps}
        initialMapCenter={{ lat: 42.6, lng: 23.3 }}
      />,
    );

    await act(async () => {
      resolvePosition?.({
        coords: { latitude: 42.7, longitude: 23.4 },
      } as GeolocationPosition);
    });

    expect(mocks.centerMap).not.toHaveBeenCalled();
  });
});
