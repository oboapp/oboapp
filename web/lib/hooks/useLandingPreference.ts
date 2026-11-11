"use client";

import { useCallback, useSyncExternalStore } from "react";

export type LandingView = "all" | "nearby" | "zones";

const STORAGE_KEY = "landingViewPreference:v2";
const LEGACY_STORAGE_KEY = "landingViewPreference:v1";
const LEGACY_LOCATION_KEY = "geolocationPermissionGranted";
const CHANGE_EVENT = "landing-view-preference-changed";

function readPreference(): LandingView {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);
    if (stored === "all" || stored === "nearby" || stored === "zones") {
      return stored;
    }

    if (globalThis.localStorage.getItem(LEGACY_STORAGE_KEY) === "zones") {
      return "zones";
    }

    if (globalThis.localStorage.getItem(LEGACY_LOCATION_KEY) === "true") {
      return "nearby";
    }

    return "all";
  } catch {
    return "all";
  }
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === STORAGE_KEY ||
      event.key === LEGACY_STORAGE_KEY ||
      event.key === LEGACY_LOCATION_KEY ||
      event.key === null
    ) {
      onChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): undefined {
  return undefined;
}

/** Resolve the browser's saved home, preserving earlier zone and location choices. */
export function useLandingPreference() {
  const preference = useSyncExternalStore<LandingView | undefined>(
    subscribe,
    readPreference,
    getServerSnapshot,
  );

  const setPreferredLandingView = useCallback((view: LandingView): boolean => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, view);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    preferredLandingView: preference ?? null,
    isLoading: preference === undefined,
    setPreferredLandingView,
  };
}
