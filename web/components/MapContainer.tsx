"use client";

import React, { useState, useEffect, useCallback } from "react";
import MapComponent from "@/components/MapComponent";
import GeolocationButton from "@/components/GeolocationButton";
import NotificationButton from "@/components/onboarding/NotificationButton";
import LoadingButton from "@/components/onboarding/LoadingButton";
import { useGeolocationPrompt } from "@/lib/hooks/useGeolocationPrompt";
import { useOnboardingFlow } from "@/lib/hooks/useOnboardingFlow";
import { useAuth } from "@/lib/auth-context";
import { Message, Interest } from "@/lib/types";
import type { User } from "firebase/auth";

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
  readonly onGeolocationPromptChange: (
    prompt: {
      show: boolean;
      onAccept: () => void;
      onDecline: () => void;
    } | null,
  ) => void;
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
  onGeolocationPromptChange,
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

    checkSubscriptions();
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

  const [isTrackingLocation, setIsTrackingLocation] = useState(false);

  const {
    showPrompt,
    onAccept,
    onDecline,
    requestGeolocation,
    autoCenter,
    isLocating,
  } = useGeolocationPrompt();

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

  // Sync geolocation prompt state to parent for proper DOM ordering
  React.useEffect(() => {
    if (showPrompt) {
      onGeolocationPromptChange({ show: true, onAccept, onDecline });
    } else {
      onGeolocationPromptChange(null);
    }
  }, [showPrompt, onAccept, onDecline, onGeolocationPromptChange]);

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
    onMapReady(centerMapFn, mapInstance);

    // Auto-center on user location if permission was previously granted
    // Only do this if there's no URL-based initial center (URL params take precedence)
    if (!initialMapCenter) {
      autoCenter(centerMapFn)
        .then((success) => {
          if (success) {
            // Enable location tracking to show the blue dot
            setIsTrackingLocation(true);
          }
        })
        .catch(() => {
          // Silently handle errors - autoCenter already logs them
        });
    }
  };

  const handleGeolocationClick = () => {
    if (centerMap) {
      requestGeolocation(centerMap)
        .then(() => {
          // Enable location tracking after successful permission grant
          setIsTrackingLocation(true);
        })
        .catch(() => {
          // User declined or error occurred - don't enable tracking
          // Error handling is already done in the hook
        });
    }
  };

  // Cleanup: disable location tracking when component unmounts
  useEffect(
    () => () => {
      setIsTrackingLocation(false);
    },
    [],
  );

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
        shouldTrackLocation={isTrackingLocation}
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

      {/* Geolocation button - always visible */}
      <GeolocationButton
        onClick={handleGeolocationClick}
        isLocating={isLocating}
        visible={true}
      />
    </div>
  );
}
