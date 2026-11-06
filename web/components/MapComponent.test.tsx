import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapComponent from "./MapComponent";

let capturedOptions: google.maps.MapOptions | undefined;
let capturedOnLoad: ((map: google.maps.Map) => void) | undefined;
const localityBounds = { north: 43, south: 42, east: 24, west: 23 };
const localityCenter = { lat: 42.7, lng: 23.3 };

vi.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({ isLoaded: true, loadError: null }),
  GoogleMap: (props: {
    options?: google.maps.MapOptions;
    onLoad?: (map: google.maps.Map) => void;
    children?: ReactNode;
  }) => {
    capturedOptions = props.options;
    capturedOnLoad = props.onLoad;
    return <div>{props.children}</div>;
  },
  Circle: () => null,
}));

vi.mock("@/lib/bounds-utils", () => ({
  getLocalityBounds: () => localityBounds,
  getLocalityCenter: () => localityCenter,
}));
vi.mock("./GeoJSONLayer", () => ({ default: () => null }));
vi.mock("./InterestCircles", () => ({ default: () => null }));
vi.mock("./InterestTargetMode", () => ({ default: () => null }));

describe("MapComponent camera options", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
    capturedOptions = undefined;
    capturedOnLoad = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("relaxes locality and zoom limits for saved zones and restores Events limits", () => {
    const { rerender } = render(<MapComponent messages={[]} />);
    expect(capturedOptions?.minZoom).toBe(12);
    expect(capturedOptions?.restriction).toEqual({
      latLngBounds: localityBounds,
      strictBounds: true,
    });

    rerender(<MapComponent messages={[]} unrestrictedCamera />);
    expect(capturedOptions?.minZoom).toBe(0);
    expect(capturedOptions?.restriction).toBeNull();

    rerender(<MapComponent messages={[]} />);
    expect(capturedOptions?.minZoom).toBe(12);
    expect(capturedOptions?.restriction?.strictBounds).toBe(true);
  });

  it("does not reset center or zoom when camera options or target mode change", () => {
    const { rerender } = render(<MapComponent messages={[]} />);
    expect(capturedOptions?.center).toEqual(localityCenter);
    expect(capturedOptions?.zoom).toBe(14);
    act(() => {
      capturedOnLoad?.({} as google.maps.Map);
    });

    rerender(<MapComponent messages={[]} unrestrictedCamera />);
    expect(capturedOptions).not.toHaveProperty("center");
    expect(capturedOptions).not.toHaveProperty("zoom");

    rerender(
      <MapComponent
        messages={[]}
        unrestrictedCamera
        targetMode={{ active: true, onSave: vi.fn(), onCancel: vi.fn() }}
      />,
    );
    expect(capturedOptions).not.toHaveProperty("center");
    expect(capturedOptions).not.toHaveProperty("zoom");
  });
});
