"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import MapComponent from "@/components/MapComponent";
import NotificationButton from "@/components/onboarding/NotificationButton";
import LoadingButton from "@/components/onboarding/LoadingButton";
import { useGeolocation } from "@/lib/hooks/useGeolocation";
import { useOnboardingFlow } from "@/lib/hooks/useOnboardingFlow";
import { useAuth } from "@/lib/auth-context";
import { Message, Interest } from "@/lib/types";
import type { User } from "firebase/auth";
import {
  getLocality,
  getLocalityBounds,
  getLocalityCenter,
  getMapViewportBounds,
} from "@/lib/bounds-utils";
import type { LandingView } from "@/lib/hooks/useLandingPreference";
import { isWithinBounds } from "@oboapp/shared";

export interface NearbyLocationState {
  readonly status: "idle" | "loading" | "ready" | "permission-required" | "error";
  readonly message: string | null;
  readonly retry: () => void;
}

type LocationStatus = Omit<NearbyLocationState, "retry">;

interface MapContainerProps {
  readonly messages: Message[];
  readonly interests: Interest[];
  readonly interestsLoaded: boolean;
  readonly user: User | null;
  readonly targetMode: {
    active: boolean;
    initialRadius?: number;
    editingInterestId?: string | null;
    pendingColor?: string;
  };
  readonly initialMapCenter?: { lat: number; lng: number } | null;
  readonly initialNavigationReady?: boolean;
  readonly navigationMode?: LandingView;
  readonly navigationSource?: "initial" | "manual";
  readonly navigationRequestId?: number;
  readonly navigationSuspended?: boolean;
  readonly onLocationStateChange?: (state: NearbyLocationState) => void;
  readonly hoveredMessageId?: string | null;
  readonly selectedMessageId?: string | null;
  readonly onFeatureClick: (messageId: string) => void;
  readonly onMapReady: (
    centerMap: (
      lat: number,
      lng: number,
      zoom?: number,
      options?: { animate?: boolean },
    ) => void,
    mapInstance: google.maps.Map | null,
  ) => void;
  readonly onBoundsChanged: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
    zoom: number;
  }) => void;
  readonly onInterestClick?: (interest: Interest) => void;
  readonly interestsInteractive?: boolean;
  readonly onSaveInterest: (
    coordinates: { lat: number; lng: number },
    radius: number,
  ) => void;
  readonly onCancelTargetMode: () => void;
  readonly onStartAddInterest: () => void;
  readonly onOnboardingStateChange: (
    state: import("@/lib/hooks/useOnboardingFlow").OnboardingState,
    callbacks: {
      onPermissionResult: (permission: NotificationPermission) => void;
      onDismiss: () => void;
      onAddInterests: () => void;
    },
  ) => void;
}

export default function MapContainer({
  messages,
  interests,
  interestsLoaded,
  user,
  targetMode,
  initialMapCenter,
  initialNavigationReady = true,
  navigationMode = "all",
  navigationSource = "initial",
  navigationRequestId = 0,
  navigationSuspended = false,
  onLocationStateChange,
  hoveredMessageId,
  selectedMessageId,
  onFeatureClick,
  onMapReady,
  onBoundsChanged,
  onInterestClick,
  interestsInteractive = true,
  onSaveInterest,
  onCancelTargetMode,
  onStartAddInterest,
  onOnboardingStateChange,
}: MapContainerProps) {
  const [centerMap, setCenterMap] = useState<
    | ((
        lat: number,
        lng: number,
        zoom?: number,
        options?: { animate?: boolean },
      ) => void)
    | null
  >(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  // Subscription check state
  const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false);
  const [hasSubscriptions, setHasSubscriptions] = useState(false);

  const {
    user: authUser,
    loading: authLoading,
    guestAuthUnavailable,
  } = useAuth();

  // Check subscriptions when user is authenticated
  // Wait for auth and interests to finish loading first to avoid flickering
  useEffect(() => {
    // Don't do anything until auth state and interests are determined
    if (authLoading || !interestsLoaded) {
      return;
    }

    if (!authUser) {
      // Not logged in - mark as loaded with no subscriptions
      setSubscriptionsLoaded(true);
      setHasSubscriptions(false);
      return;
    }

    const checkSubscriptions = async () => {
      try {
        const token = await authUser.getIdToken();
        const response = await fetch("/api/notifications/subscription/all", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const subscriptions = await response.json();
          setHasSubscriptions(
            Array.isArray(subscriptions) && subscriptions.length > 0,
          );
        }
      } catch (error) {
        console.error("Error checking subscriptions:", error);
      } finally {
        setSubscriptionsLoaded(true);
      }
    };

    void checkSubscriptions();
  }, [authUser, authLoading, interestsLoaded]);

  // Onboarding state machine
  const {
    state: onboardingState,
    handlePermissionResult,
    handleDismiss,
    handleRestart,
  } = useOnboardingFlow({
    user: authUser,
    interests,
    subscriptionsLoaded,
    hasSubscriptions,
    guestAvailable: !guestAuthUnavailable,
  });

  const [locationStatus, setLocationStatus] = useState<
    LocationStatus & { requestKey: string | null }
  >({
    requestKey: null,
    status: "idle",
    message: null,
  });
  const handledNavigation = useRef<string | null>(null);
  const locationRequest = useRef(0);
  const navigationBlocked =
    navigationSuspended ||
    targetMode.active ||
    (navigationSource === "initial" && Boolean(initialMapCenter));
  const nearbyEnabled =
    initialNavigationReady && navigationMode === "nearby" && !navigationBlocked;
  const navigationKey = `${navigationMode}:${navigationRequestId}`;
  if (
    initialNavigationReady &&
    navigationMode === "nearby" &&
    navigationBlocked &&
    (locationStatus.requestKey !== navigationKey || locationStatus.status === "loading")
  ) {
    setLocationStatus({
      requestKey: navigationKey,
      status: "permission-required",
      message: "Определянето на местоположението беше прекъснато. Опитай отново, когато приключиш с текущото действие.",
    });
  }

  const currentLocationStatus = React.useMemo<LocationStatus>(() => {
    if (!initialNavigationReady || navigationMode !== "nearby") {
      return { status: "idle", message: null };
    }

    if (locationStatus.requestKey !== navigationKey) {
      return { status: "loading", message: null };
    }

    return { status: locationStatus.status, message: locationStatus.message };
  }, [initialNavigationReady, navigationMode, locationStatus, navigationKey]);
  const { locate, cancel } = useGeolocation({ enabled: nearbyEnabled });

  const showCity = useCallback(() => {
    if (!centerMap) {
      return;
    }

    if (map) {
      map.fitBounds(getLocalityBounds(), 32);
      return;
    }

    const center = getLocalityCenter();
    centerMap(center.lat, center.lng, 12, { animate: false });
  }, [centerMap, map]);

  const requestLocation = useCallback(
    async (automatic: boolean) => {
      if (!centerMap || !nearbyEnabled) {
        return;
      }

      const request = ++locationRequest.current;
      setLocationStatus({
        requestKey: navigationKey,
        status: "loading",
        message: null,
      });
      const result = await locate(
        (position) => {
          if (!isWithinBounds(getLocality(), position.lat, position.lng)) {
            throw new Error("Местоположението ти е извън поддържаната карта.");
          }

          centerMap(position.lat, position.lng, 17, { animate: false });
          const viewportBounds = getMapViewportBounds(map);
          if (viewportBounds) {
            onBoundsChanged(viewportBounds);
          }
        },
        { automatic },
      );

      if (request !== locationRequest.current || result.status === "canceled") {
        return;
      }

      if (result.status !== "ready") {
        showCity();
      }

      setLocationStatus({
        requestKey: navigationKey,
        status: result.status,
        message: result.message,
      });
    },
    [centerMap, nearbyEnabled, locate, showCity, navigationKey, map, onBoundsChanged],
  );

  const retryLocation = useCallback(() => {
    void requestLocation(false);
  }, [requestLocation]);
  const { status: nearbyStatus, message: nearbyMessage } = currentLocationStatus;

  useEffect(() => {
    onLocationStateChange?.({
      status: nearbyStatus,
      message: nearbyMessage,
      retry: retryLocation,
    });
  }, [onLocationStateChange, nearbyStatus, nearbyMessage, retryLocation]);

  useEffect(() => {
    if (!centerMap || !initialNavigationReady) {
      return;
    }

    if (handledNavigation.current === navigationKey) {
      return;
    }

    handledNavigation.current = navigationKey;
    if (navigationBlocked) {
      return;
    }

    if (navigationMode === "all") {
      showCity();
    }

    if (navigationMode === "nearby") {
      void requestLocation(navigationSource === "initial");
    }
  }, [
    centerMap,
    initialNavigationReady,
    navigationMode,
    navigationRequestId,
    navigationKey,
    navigationBlocked,
    navigationSource,
    requestLocation,
    showCity,
  ]);

  useEffect(() => {
    return () => {
      locationRequest.current += 1;
      cancel();
    };
  }, [navigationMode, navigationRequestId, navigationBlocked, cancel]);

  // Handle add interest button click in idle state
  // If logged in, go directly to creation mode (skip showing AddInterestsPrompt again)
  // If not logged in, restart the onboarding flow
  const handleAddInterestClick = useCallback(() => {
    if (onboardingState === "idle") {
      if (authUser && !authUser.isAnonymous) {
        // Non-anonymous user already dismissed AddInterestsPrompt, go straight to creation
        onStartAddInterest();
      } else {
        // Not logged in (or anonymous guest), restart onboarding flow
        handleRestart();
      }
    } else {
      onStartAddInterest();
    }
  }, [onboardingState, authUser, handleRestart, onStartAddInterest]);

  // Memoize onboarding callbacks to prevent useEffect loop
  const onboardingCallbacks = React.useMemo(
    () => ({
      onPermissionResult: handlePermissionResult,
      onDismiss: handleDismiss,
      onAddInterests: onStartAddInterest,
    }),
    [handlePermissionResult, handleDismiss, onStartAddInterest],
  );

  // Sync onboarding state to parent for proper DOM ordering
  React.useEffect(() => {
    onOnboardingStateChange(onboardingState, onboardingCallbacks);
  }, [onboardingState, onboardingCallbacks, onOnboardingStateChange]);

  const handleMapReady = (
    centerMapFn: (
      lat: number,
      lng: number,
      zoom?: number,
      options?: { animate?: boolean },
    ) => void,
    mapInstance: google.maps.Map | null,
  ) => {
    setCenterMap(() => centerMapFn);
    setMap(mapInstance);
    onMapReady(centerMapFn, mapInstance);
  };

  return (
    <div className="absolute inset-0">
      <MapComponent
        messages={messages}
        onFeatureClick={onFeatureClick}
        onMapReady={handleMapReady}
        onBoundsChanged={onBoundsChanged}
        interests={interests}
        onInterestClick={onInterestClick}
        interestsInteractive={interestsInteractive}
        initialCenter={initialMapCenter || undefined}
        shouldTrackLocation={nearbyEnabled && currentLocationStatus.status === "ready"}
        hoveredMessageId={hoveredMessageId}
        selectedMessageId={selectedMessageId}
        targetMode={
          targetMode.active
            ? {
                active: true,
                initialRadius: targetMode.initialRadius,
                editingInterestId: targetMode.editingInterestId,
                pendingColor: targetMode.pendingColor,
                onSave: onSaveInterest,
                onCancel: onCancelTargetMode,
              }
            : undefined
        }
      />

      {/* Onboarding buttons (without backdrops) - positioned relative to map */}
      {!targetMode.active && (
        <>
          {onboardingState === "loading" && <LoadingButton visible={true} />}
          {onboardingState === "idle" && (
            <NotificationButton
              onClick={handleAddInterestClick}
              visible={true}
            />
          )}
        </>
      )}

    </div>
  );
}
