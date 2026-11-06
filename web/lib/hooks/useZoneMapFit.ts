import { useEffect, useRef } from "react";
import type { Interest } from "@/lib/types";
import { getZoneBounds } from "@/lib/zone-bounds";

const ZONE_FIT_PADDING_PX = 56;

interface ZoneMapFitOptions {
  readonly active: boolean;
  readonly interests: readonly Interest[];
  readonly interestsLoaded: boolean;
  readonly map: google.maps.Map | null;
  readonly suspended: boolean;
  readonly onBeforeFit?: () => void;
  readonly userId?: string;
}

/** Fit saved circles once per entry, after both the map and zones are ready. */
export function useZoneMapFit({
  active,
  interests,
  interestsLoaded,
  map,
  suspended,
  onBeforeFit,
  userId,
}: ZoneMapFitOptions) {
  const entryHandled = useRef(false);
  const entryUserId = useRef(userId);

  useEffect(() => {
    if (!active || entryUserId.current !== userId) {
      entryHandled.current = false;
      entryUserId.current = userId;
    }

    if (!active) {
      return;
    }

    // An explicit event or zone edit owns the camera for this entry.
    if (suspended) {
      entryHandled.current = true;
      return;
    }

    if (entryHandled.current || !interestsLoaded || !map) {
      return;
    }

    entryHandled.current = true;
    const bounds = getZoneBounds(interests);
    if (bounds) {
      onBeforeFit?.();
      map.fitBounds(bounds, ZONE_FIT_PADDING_PX);
      // Reapply the requested center at the fitted zoom under strict map bounds.
      map.setCenter(new google.maps.LatLngBounds(bounds).getCenter());
    }
  }, [active, interests, interestsLoaded, map, suspended, onBeforeFit, userId]);
}
