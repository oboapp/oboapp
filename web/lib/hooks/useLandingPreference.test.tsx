import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLandingPreference } from "./useLandingPreference";

const STORAGE_KEY = "landingViewPreference:v2";
const LEGACY_STORAGE_KEY = "landingViewPreference:v1";
const LEGACY_LOCATION_KEY = "geolocationPermissionGranted";

describe("useLandingPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the city overview without saving a default", () => {
    const { result } = renderHook(() => useLandingPreference());

    expect(result.current.preferredLandingView).toBe("all");
    expect(result.current.isLoading).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it.each(["all", "nearby", "zones"] as const)(
    "restores the saved %s choice on a returning visit",
    (view) => {
      const firstVisit = renderHook(() => useLandingPreference());

      act(() => {
        expect(firstVisit.result.current.setPreferredLandingView(view)).toBe(true);
      });
      firstVisit.unmount();

      const returningVisit = renderHook(() => useLandingPreference());

      expect(returningVisit.result.current.preferredLandingView).toBe(view);
    },
  );

  it.each([
    { legacyView: "zones", locationEnabled: false, expected: "zones" },
    { legacyView: "zones", locationEnabled: true, expected: "zones" },
    { legacyView: "events", locationEnabled: false, expected: "all" },
    { legacyView: "events", locationEnabled: true, expected: "nearby" },
    { legacyView: null, locationEnabled: false, expected: "all" },
    { legacyView: null, locationEnabled: true, expected: "nearby" },
  ] as const)(
    "preserves legacy home=$legacyView and location=$locationEnabled as $expected without writing",
    ({ legacyView, locationEnabled, expected }) => {
      if (legacyView) {
        localStorage.setItem(LEGACY_STORAGE_KEY, legacyView);
      }
      localStorage.setItem(LEGACY_LOCATION_KEY, String(locationEnabled));

      const { result } = renderHook(() => useLandingPreference());

      expect(result.current.preferredLandingView).toBe(expected);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(legacyView);
    },
  );

  it.each(["all", "nearby", "zones"] as const)(
    "keeps an explicit %s home ahead of legacy zone and location choices",
    (view) => {
      localStorage.setItem(STORAGE_KEY, view);
      localStorage.setItem(LEGACY_STORAGE_KEY, "zones");
      localStorage.setItem(LEGACY_LOCATION_KEY, "true");

      const { result } = renderHook(() => useLandingPreference());

      expect(result.current.preferredLandingView).toBe(view);
    },
  );

  it("uses a legacy choice when the new saved value is unsupported", () => {
    localStorage.setItem(STORAGE_KEY, "unsupported");
    localStorage.setItem(LEGACY_STORAGE_KEY, "zones");

    const { result } = renderHook(() => useLandingPreference());

    expect(result.current.preferredLandingView).toBe("zones");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("unsupported");
  });

  it("stops legacy automatic location when All is explicitly saved", () => {
    localStorage.setItem(LEGACY_LOCATION_KEY, "true");
    const firstVisit = renderHook(() => useLandingPreference());
    expect(firstVisit.result.current.preferredLandingView).toBe("nearby");

    act(() => {
      firstVisit.result.current.setPreferredLandingView("all");
    });
    firstVisit.unmount();

    const returningVisit = renderHook(() => useLandingPreference());

    expect(returningVisit.result.current.preferredLandingView).toBe("all");
    expect(localStorage.getItem(LEGACY_LOCATION_KEY)).toBe("true");
  });

  it("updates other mounted consumers when the setting changes", () => {
    const settings = renderHook(() => useLandingPreference());
    const home = renderHook(() => useLandingPreference());

    act(() => {
      settings.result.current.setPreferredLandingView("zones");
    });

    expect(settings.result.current.preferredLandingView).toBe("zones");
    expect(home.result.current.preferredLandingView).toBe("zones");
  });

  it("receives changes and cleared preferences from another browser tab", () => {
    const { result } = renderHook(() => useLandingPreference());

    act(() => {
      localStorage.setItem(STORAGE_KEY, "zones");
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });
    expect(result.current.preferredLandingView).toBe("zones");

    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current.preferredLandingView).toBe("all");
  });

  it("receives legacy storage changes until an explicit new home is saved", () => {
    const { result } = renderHook(() => useLandingPreference());

    act(() => {
      localStorage.setItem(LEGACY_LOCATION_KEY, "true");
      window.dispatchEvent(new StorageEvent("storage", { key: LEGACY_LOCATION_KEY }));
    });
    expect(result.current.preferredLandingView).toBe("nearby");

    act(() => {
      localStorage.setItem(LEGACY_STORAGE_KEY, "zones");
      window.dispatchEvent(new StorageEvent("storage", { key: LEGACY_STORAGE_KEY }));
    });
    expect(result.current.preferredLandingView).toBe("zones");

    act(() => {
      result.current.setPreferredLandingView("all");
      localStorage.setItem(LEGACY_LOCATION_KEY, "false");
      window.dispatchEvent(new StorageEvent("storage", { key: LEGACY_LOCATION_KEY }));
    });
    expect(result.current.preferredLandingView).toBe("all");
  });

  it("ignores unsupported saved values", () => {
    localStorage.setItem(STORAGE_KEY, "invalid");

    const { result } = renderHook(() => useLandingPreference());

    expect(result.current.preferredLandingView).toBe("all");
    expect(result.current.isLoading).toBe(false);
  });

  it("reports a failed save and preserves the previous preference", () => {
    localStorage.setItem(STORAGE_KEY, "all");
    const { result } = renderHook(() => useLandingPreference());
    const storedValues = localStorage;
    vi.stubGlobal("localStorage", {
      getItem: storedValues.getItem.bind(storedValues),
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    });

    act(() => {
      expect(result.current.setPreferredLandingView("zones")).toBe(false);
    });

    expect(result.current.preferredLandingView).toBe("all");
  });

  it("preserves the default view when browser storage cannot be read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
    });

    const { result } = renderHook(() => useLandingPreference());

    expect(result.current.preferredLandingView).toBe("all");
    expect(result.current.isLoading).toBe(false);
  });

  it("waits for the client preference during server rendering", () => {
    localStorage.setItem(STORAGE_KEY, "zones");
    const getItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem });

    function ServerPreference() {
      const { isLoading, preferredLandingView } = useLandingPreference();
      return <span>{isLoading ? "loading" : preferredLandingView}</span>;
    }

    expect(renderToString(<ServerPreference />)).toBe("<span>loading</span>");
    expect(getItem).not.toHaveBeenCalled();
  });
});
