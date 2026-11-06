"use client";

import { useState, useCallback, useLayoutEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";

interface GeolocationPromptState {
  show: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

const GEOLOCATION_PERMISSION_KEY = "geolocationPermissionGranted";

interface GeolocationPromptOptions {
  readonly automaticCenterEnabled?: boolean;
}

export function useGeolocationPrompt({
  automaticCenterEnabled = true,
}: GeolocationPromptOptions = {}) {
  const [promptState, setPromptState] = useState<GeolocationPromptState | null>(
    null,
  );
  const [isLocating, setIsLocating] = useState(false);
  const cameraGeneration = useRef(0);
  const latestLocationRequest = useRef(0);

  useLayoutEffect(() => {
    return () => {
      cameraGeneration.current += 1;
    };
  }, [automaticCenterEnabled]);

  const getStoredPermissionState = useCallback(() => {
    try {
      const stored = localStorage.getItem(GEOLOCATION_PERMISSION_KEY);
      return stored === "true";
    } catch {
      return false;
    }
  }, []);

  const setStoredPermissionState = useCallback((granted: boolean) => {
    try {
      localStorage.setItem(GEOLOCATION_PERMISSION_KEY, granted.toString());
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const getCurrentPosition = useCallback(() => {
    const request = ++latestLocationRequest.current;
    setIsLocating(true);

    return new Promise<{ lat: number; lng: number }>((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Geolocation is not supported"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          let errorMessage =
            "Неизвестна грешка при определяне на местоположението";

          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "Достъпът до местоположението е отказан";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "Местоположението не може да бъде определено";
              break;
            case error.TIMEOUT:
              errorMessage = "Изтече времето за определяне на местоположението";
              break;
          }

          reject(new Error(errorMessage));
        },
        {
          enableHighAccuracy: false, // Accept coarse location
          timeout: 15000, // 15 seconds timeout
          maximumAge: 300000, // 5 minutes cache
        },
      );
    }).finally(() => {
      if (request === latestLocationRequest.current) {
        setIsLocating(false);
      }
    });
  }, []);

  const requestGeolocation = useCallback(
    async (
      centerMap: (
        lat: number,
        lng: number,
        zoom?: number,
        options?: { animate?: boolean },
      ) => void,
    ): Promise<void> => {
      // An explicit location request takes priority over automatic centering.
      const generation = ++cameraGeneration.current;
      const hasPermission = getStoredPermissionState();

      if (hasPermission) {
        // Permission already granted, directly get location
        try {
          const position = await getCurrentPosition();
          if (generation !== cameraGeneration.current) {
            return;
          }

          centerMap(position.lat, position.lng, 17, { animate: true });

          trackEvent({
            name: "geolocation_location_centered",
            params: { had_cached_permission: true },
          });
          return;
        } catch (error) {
          console.error("Geolocation error:", error);
          toast.error(
            error instanceof Error
              ? error.message
              : "Грешка при определяне на местоположението",
          );

          trackEvent({
            name: "geolocation_error",
            params: {
              error_type: "location_failed",
              had_cached_permission: true,
            },
          });
          throw error;
        }
      }

      // Show permission prompt first - return a promise that resolves when accepted
      return new Promise<void>((resolve, reject) => {
        const handleAccept = async () => {
          setPromptState(null);

          try {
            const position = await getCurrentPosition();
            setStoredPermissionState(true);

            trackEvent({
              name: "geolocation_permission_granted",
              params: {},
            });

            if (generation !== cameraGeneration.current) {
              resolve();
              return;
            }

            centerMap(position.lat, position.lng, 17, { animate: true });

            trackEvent({
              name: "geolocation_location_centered",
              params: { had_cached_permission: false },
            });
            resolve();
          } catch (error) {
            console.error("Geolocation error:", error);
            toast.error(
              error instanceof Error
                ? error.message
                : "Грешка при определяне на местоположението",
            );

            trackEvent({
              name: "geolocation_permission_denied",
              params: {},
            });
            reject(error);
          }
        };

        setPromptState({
          show: true,
          onAccept: () => {
            void handleAccept();
          },
          onDecline: () => {
            setPromptState(null);

            trackEvent({
              name: "geolocation_prompt_declined",
              params: {},
            });
            reject(new Error("User declined geolocation permission"));
          },
        });

        trackEvent({
          name: "geolocation_prompt_shown",
          params: {},
        });
      });
    },
    [getCurrentPosition, getStoredPermissionState, setStoredPermissionState],
  );

  const hidePrompt = useCallback(() => {
    setPromptState(null);
  }, []);

  const autoCenter = useCallback(
    async (
      centerMap: (
        lat: number,
        lng: number,
        zoom?: number,
        options?: { animate?: boolean },
      ) => void,
    ): Promise<boolean> => {
      if (!automaticCenterEnabled) {
        return false;
      }

      const hasPermission = getStoredPermissionState();

      if (!hasPermission) {
        // No cached permission, don't auto-center
        return false;
      }

      // Permission already granted, directly get location
      const generation = ++cameraGeneration.current;
      try {
        const position = await getCurrentPosition();
        if (generation !== cameraGeneration.current) {
          return false;
        }

        centerMap(position.lat, position.lng, 17, { animate: false });

        trackEvent({
          name: "geolocation_location_centered",
          params: { had_cached_permission: true, auto_centered: true },
        });
        return true;
      } catch (error) {
        console.error("Geolocation error during auto-center:", error);
        // Don't show alert for auto-center failures - this is a background operation
        trackEvent({
          name: "geolocation_error",
          params: {
            error_type: "location_failed",
            had_cached_permission: true,
            auto_centered: true,
          },
        });
        return false;
      }
    },
    [automaticCenterEnabled, getCurrentPosition, getStoredPermissionState],
  );

  return {
    showPrompt: promptState?.show || false,
    onAccept: promptState?.onAccept || (() => {}),
    onDecline: promptState?.onDecline || (() => {}),
    requestGeolocation,
    autoCenter,
    hidePrompt,
    isLocating,
  };
}
