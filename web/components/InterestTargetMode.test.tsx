import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InterestTargetMode from "./InterestTargetMode";

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackEventDebounced: vi.fn(),
}));

type ClickListener = (event: google.maps.MapMouseEvent) => void;
const circles: MockCircle[] = [];

class MockCircle {
  readonly listeners = new Map<string, ClickListener>();
  readonly setCenter = vi.fn();
  readonly setRadius = vi.fn();
  readonly setOptions = vi.fn();
  readonly setMap = vi.fn();
  readonly addListener = vi.fn((event: string, listener: ClickListener) => {
    this.listeners.set(event, listener);
    return { remove: vi.fn() };
  });

  constructor(readonly options: google.maps.CircleOptions) {
    circles.push(this);
  }
}

function mapFixture() {
  const listeners = new Map<string, ClickListener>();
  const map = {
    getCenter: vi.fn((): { lat: () => number; lng: () => number } => ({
      lat: () => 42.712345678,
      lng: () => 23.412345678,
    })),
    addListener: vi.fn((event: string, listener: ClickListener) => {
      listeners.set(event, listener);
      return { remove: vi.fn() };
    }),
  };
  return { map, listeners, instance: map as unknown as google.maps.Map };
}

function clickAt(listener: ClickListener | undefined, lat: number, lng: number) {
  act(() => {
    listener?.({
      latLng: { lat: () => lat, lng: () => lng },
    } as google.maps.MapMouseEvent);
  });
}

describe("InterestTargetMode placement", () => {
  beforeEach(() => {
    circles.length = 0;
    vi.stubGlobal("google", {
      maps: {
        Circle: MockCircle,
        event: {
          clearInstanceListeners: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts a new zone only after placement and saves circle moves with the chosen radius", () => {
    const fixture = mapFixture();
    const onSave = vi.fn();
    const { unmount } = render(
      <InterestTargetMode map={fixture.instance} onSave={onSave} onCancel={vi.fn()} />,
    );
    expect(circles).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Запази зоната" })).toBeDisabled();

    clickAt(fixture.listeners.get("click"), 42.723456789, 23.423456789);
    expect(circles).toHaveLength(1);
    expect(circles[0].options.center).toEqual({ lat: 42.723457, lng: 23.423457 });
    fireEvent.change(screen.getByRole("slider"), { target: { value: "650" } });
    expect(circles[0].setRadius).toHaveBeenLastCalledWith(650);

    clickAt(circles[0].listeners.get("click"), 42.734567891, 23.434567891);
    fireEvent.click(screen.getByRole("button", { name: "Запази зоната" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ lat: 42.734568, lng: 23.434568 }, 650);
    expect(circles).toHaveLength(1);

    unmount();
    expect(circles[0].setMap).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("captures the editing center when the map arrives and preserves it across later camera changes", () => {
    const fixture = mapFixture();
    const onSave = vi.fn();
    const props = { isEditing: true, initialRadius: 300, onSave, onCancel: vi.fn() };
    const { rerender } = render(<InterestTargetMode {...props} map={null} />);
    expect(circles).toHaveLength(0);

    rerender(<InterestTargetMode {...props} map={fixture.instance} />);
    expect(circles).toHaveLength(1);
    expect(circles[0].options.center).toEqual({ lat: 42.712346, lng: 23.412346 });
    fixture.map.getCenter.mockReturnValue({ lat: () => 42.8, lng: () => 23.5 });
    rerender(<InterestTargetMode {...props} map={fixture.instance} />);
    fireEvent.click(screen.getByRole("button", { name: "Запази зоната" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ lat: 42.712346, lng: 23.412346 }, 300);
    expect(circles).toHaveLength(1);
  });
});
