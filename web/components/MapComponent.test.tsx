import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapComponent from "./MapComponent";
import type { Interest } from "@/lib/types";

let capturedOptions: google.maps.MapOptions | undefined;
let capturedOnLoad: ((map: google.maps.Map) => void) | undefined;
const localityBounds = { north: 43, south: 42, east: 24, west: 23 };
const localityCenter = { lat: 42.7, lng: 23.3 };
const savedInterests: Interest[] = [
  {
    id: "home",
    userId: "user-1",
    coordinates: { lat: 42.7, lng: 23.3 },
    radius: 500,
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: new Date("2026-11-06T00:00:00.000Z"),
  },
];

function expectLocalityCameraLimits() {
  expect(capturedOptions?.minZoom).toBe(12);
  expect(capturedOptions?.maxZoom).toBe(18);
  expect(capturedOptions?.restriction).toEqual({
    latLngBounds: localityBounds,
    strictBounds: true,
  });
}

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

vi.mock("@/lib/bounds-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bounds-utils")>()),
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

  it("keeps locality and zoom limits while saved zones load and change", () => {
    const { rerender } = render(<MapComponent messages={[]} interests={[]} />);
    expectLocalityCameraLimits();

    act(() => {
      capturedOnLoad?.({} as google.maps.Map);
    });

    rerender(<MapComponent messages={[]} interests={savedInterests} />);
    expectLocalityCameraLimits();

    rerender(<MapComponent messages={[]} interests={[]} />);
    expectLocalityCameraLimits();
  });

  it("keeps locality and zoom limits when entering and leaving target mode", () => {
    const { rerender } = render(<MapComponent messages={[]} />);
    act(() => {
      capturedOnLoad?.({} as google.maps.Map);
    });

    rerender(
      <MapComponent
        messages={[]}
        interests={savedInterests}
        targetMode={{ active: true, onSave: vi.fn(), onCancel: vi.fn() }}
      />,
    );
    expectLocalityCameraLimits();
    expect(capturedOptions?.scrollwheel).toBe(true);
    expect(capturedOptions?.disableDoubleClickZoom).toBe(false);

    rerender(<MapComponent messages={[]} interests={savedInterests} />);
    expectLocalityCameraLimits();
  });

  it("does not reset center or zoom when saved zones or target mode change", () => {
    const { rerender } = render(<MapComponent messages={[]} />);
    expect(capturedOptions?.center).toEqual(localityCenter);
    expect(capturedOptions?.zoom).toBe(14);
    act(() => {
      capturedOnLoad?.({} as google.maps.Map);
    });

    rerender(
      <MapComponent
        messages={[]}
        interests={savedInterests}
        initialCenter={{ lat: 42.8, lng: 23.4 }}
      />,
    );
    expect(capturedOptions).not.toHaveProperty("center");
    expect(capturedOptions).not.toHaveProperty("zoom");

    rerender(
      <MapComponent
        messages={[]}
        interests={savedInterests}
        targetMode={{ active: true, onSave: vi.fn(), onCancel: vi.fn() }}
      />,
    );
    expect(capturedOptions).not.toHaveProperty("center");
    expect(capturedOptions).not.toHaveProperty("zoom");
  });
});
