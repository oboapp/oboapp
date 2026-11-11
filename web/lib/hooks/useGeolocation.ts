"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";

interface GeolocationOptions {
  readonly enabled: boolean;
}

export interface GeolocationResult {
  readonly status: "ready" | "permission-required" | "error" | "canceled";
  readonly message: string | null;
}

interface LocateOptions {
  readonly automatic: boolean;
}

function getLocationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "code" in error) {
    switch (error.code) {
      case 1:
        return "Достъпът до местоположението е отказан. Можеш да го разрешиш от настройките на браузъра.";
      case 2:
        return "Местоположението не може да бъде определено.";
      case 3:
        return "Изтече времето за определяне на местоположението. Опитай отново.";
    }
  }

  return "Не успяхме да определим местоположението ти. Опитай отново.";
}

async function getLocationPermission(): Promise<PermissionState | null> {
  if (!navigator.permissions?.query) {
    return null;
  }

  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    return permission.state;
  } catch {
    return null;
  }
}

/** Request location for the active visit without changing the saved home. */
export function useGeolocation({ enabled }: GeolocationOptions) {
  const generation = useRef(0);

  useLayoutEffect(() => {
    return () => {
      generation.current += 1;
    };
  }, [enabled]);

  const cancel = useCallback(() => {
    generation.current += 1;
  }, []);

  const locate = useCallback(
    async (
      onPosition: (position: { lat: number; lng: number }) => void,
      { automatic }: LocateOptions,
    ): Promise<GeolocationResult> => {
      const request = ++generation.current;
      const canceled: GeolocationResult = { status: "canceled", message: null };

      if (!enabled) {
        return canceled;
      }

      if (!("geolocation" in navigator) || !navigator.geolocation) {
        return {
          status: "error",
          message: "Този браузър не поддържа определяне на местоположение.",
        };
      }

      if (automatic) {
        const permission = await getLocationPermission();
        if (request !== generation.current) {
          return canceled;
        }

        if (permission !== "granted") {
          return {
            status: "permission-required",
            message:
              permission === "denied"
                ? "Достъпът до местоположението е отказан. Разреши го от настройките на браузъра или избери друг изглед."
                : "Разреши достъп до местоположението, за да видиш събитията около теб.",
          };
        }
      }

      try {
        const position = await new Promise<{ lat: number; lng: number }>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              (result) => {
                resolve({
                  lat: result.coords.latitude,
                  lng: result.coords.longitude,
                });
              },
              reject,
              { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
            );
          },
        );

        if (request !== generation.current) {
          return canceled;
        }

        onPosition(position);
        trackEvent({
          name: "geolocation_location_centered",
          params: { had_cached_permission: automatic, auto_centered: automatic },
        });
        return { status: "ready", message: null };
      } catch (error) {
        if (request !== generation.current) {
          return canceled;
        }

        trackEvent({
          name: "geolocation_error",
          params: {
            error_type: "location_failed",
            had_cached_permission: automatic,
            auto_centered: automatic,
          },
        });
        return { status: "error", message: getLocationError(error) };
      }
    },
    [enabled],
  );

  return { locate, cancel };
}
