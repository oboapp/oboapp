"use client";

import React, {
  useCallback,
  useRef,
  useMemo,
  useState,
  useEffect,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MapContainer, { type NearbyLocationState } from "@/components/MapContainer";
import MessageDetailView from "@/components/MessageDetailView/MessageDetailView";
import MessagesGrid from "@/components/MessagesGrid";
import InterestContextMenu from "@/components/InterestContextMenu";
import FilterBox from "@/components/FilterBox";
import OnboardingPrompt from "@/components/onboarding/OnboardingPrompt";
import UpgradeConflictPrompt from "@/components/onboarding/UpgradeConflictPrompt";
import AddZoneModal from "@/components/onboarding/AddZoneModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { PendingZone } from "@/components/onboarding/AddZoneModal";
import SegmentedControl from "@/components/SegmentedControl";
import ZoneList from "@/components/ZoneList";
import { NearbyLocationStatus } from "@/components/NearbyLocationStatus";
import { useInterests } from "@/lib/hooks/useInterests";
import { useLocalityBoundaries } from "@/lib/hooks/useLocalityBoundaries";
import { useAuth } from "@/lib/auth-context";
import { useMessages } from "@/lib/hooks/useMessages";
import { useMapNavigation } from "@/lib/hooks/useMapNavigation";
import { useZoneMapFit } from "@/lib/hooks/useZoneMapFit";
import { useInterestManagement } from "@/lib/hooks/useInterestManagement";
import { useCategoryFilter } from "@/lib/hooks/useCategoryFilter";
import { useSourceFilter } from "@/lib/hooks/useSourceFilter";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import {
  useLandingPreference,
  type LandingView,
} from "@/lib/hooks/useLandingPreference";
import { parseMapCenterFromParams } from "@/lib/hooks/useMapNavigation.utils";
import { classifyMessage } from "@/lib/message-classification";
import { filterEventsByZones } from "@/lib/zone-event-filter";
import { createMessageUrl } from "@/lib/url-utils";
import { getFeaturesBounds, getFeaturesCentroid } from "@/lib/geometry-utils";
import { zIndex } from "@/lib/colors";
import { buttonStyles, buttonSizes, borderRadius } from "@/lib/theme";
import PlusIcon from "@/components/icons/PlusIcon";
import { navigateBackOrReplace } from "@/lib/navigation-utils";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/pwa-metadata";
import {
  PENDING_GUEST_UPGRADE_UID_KEY,
  PENDING_GUEST_UPGRADE_TOKEN_KEY,
  type UpgradeDecisionOption,
} from "@/lib/auth-upgrade";
import type { Interest } from "@/lib/types";
import type { OnboardingState } from "@/lib/hooks/useOnboardingFlow";
import { useMessageByIdFallback } from "@/lib/hooks/useMessageByIdFallback";

const WIDE_DESKTOP_MEDIA_QUERY =
  "(min-width: 1280px) and (min-aspect-ratio: 4/3)";
const MESSAGE_FIT_BOUNDS_PADDING_PX = 56;
const HOME_VIEW_TOAST_ID = "home-view-preference";

function getEventSectionLabel(view: LandingView): string {
  if (view === "zones") {
    return "Събития в моите зони";
  }
  if (view === "nearby") {
    return "Събития около мен";
  }
  return "Събития";
}

const VIEW_MODE_OPTIONS = [
  { value: "all" as const, label: "Всички" },
  { value: "nearby" as const, label: "Около мен" },
  { value: "zones" as const, label: "Моите зони" },
] as const;

const VIEW_MODE_OPTIONS_NO_USER = [
  { value: "all" as const, label: "Всички" },
  { value: "nearby" as const, label: "Около мен" },
  { value: "zones" as const, label: "Моите зони", disabled: true },
] as const;

/**
 * Coordinate the map, messages, filters, and saved zones.
 * Events follows the viewport. My zones matches the full recent message batch
 * against saved circles. The map stays visible while the active batch loads.
 */
function HomeContentInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Core hooks
  const {
    interests,
    hasInitialized: interestsLoaded,
    addInterest,
    updateInterest,
    deleteInterest,
  } = useInterests();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const isWideDesktopLayout = useMediaQuery(WIDE_DESKTOP_MEDIA_QUERY);
  const {
    preferredLandingView,
    isLoading: preferenceLoading,
    setPreferredLandingView,
  } = useLandingPreference();
  const messageId = searchParams.get("messageId");
  const hasExplicitNavigation = Boolean(
    messageId ||
      parseMapCenterFromParams(searchParams.get("lat"), searchParams.get("lng")),
  );
  const [viewMode, setViewMode] = useState<LandingView | null>(null);
  const [navigation, setNavigation] = useState<{
    source: "initial" | "manual";
    requestId: number;
  }>({ source: "initial", requestId: 0 });
  const [nearbyLocation, setNearbyLocation] = useState<NearbyLocationState>({
    status: "idle",
    message: null,
    retry: () => {},
  });
  const isLandingPending =
    viewMode === null &&
    !hasExplicitNavigation &&
    (preferenceLoading ||
      (preferredLandingView === "zones" &&
        (authLoading || Boolean(user && !interestsLoaded))));

  // Capture the initial choice once. Later tab switches belong to this visit.
  if (viewMode === null && !isLandingPending) {
    setViewMode(
      hasExplicitNavigation ? "all" : (preferredLandingView ?? "all"),
    );
  }

  const effectiveViewMode =
    viewMode === "zones" && !user ? "all" : (viewMode ?? "all");
  const nearbyReady =
    effectiveViewMode !== "nearby" || nearbyLocation.status === "ready";

  // My zones matches against the full recent batch, independently of the camera.
  const {
    messages,
    availableCategories,
    isLoading,
    error,
    handleBoundsChanged,
    suppressNextViewportFetch,
    resetViewport,
    setSelectedCategories,
    setSelectedSources,
  } = useMessages({
    scope: effectiveViewMode === "zones" ? "all" : "viewport",
    enabled:
      !isLandingPending &&
      nearbyReady &&
      (effectiveViewMode !== "zones" ||
        (interestsLoaded && interests.length > 0)),
  });

  const handleLocationStateChange = useCallback(
    (state: NearbyLocationState) => {
      if (state.status === "loading") {
        resetViewport();
      }
      setNearbyLocation(state);
    },
    [resetViewport],
  );

  const handleViewChange = useCallback((value: string) => {
    const mode = value === "zones" || value === "nearby" ? value : "all";
    if (mode === "nearby") {
      resetViewport();
      setNearbyLocation((previous) => ({
        ...previous,
        status: "loading",
        message: null,
      }));
    }
    setNavigation((previous) => ({
      source: "manual",
      requestId: previous.requestId + 1,
    }));
    setViewMode(mode);
  }, [resetViewport]);

  const handleHomeChange = useCallback((value: string) => {
    const mode = value === "zones" || value === "nearby" ? value : "all";
    const label =
      VIEW_MODE_OPTIONS.find((option) => option.value === mode)?.label ??
      VIEW_MODE_OPTIONS[0].label;
    if ((preferredLandingView ?? "all") === mode) {
      toast.info(`„${label}“ е началният ти изглед в ${APP_NAME}.`, {
        id: HOME_VIEW_TOAST_ID,
      });
      return;
    }
    if (!setPreferredLandingView(mode)) {
      toast.error("Началният изглед не се запази. Опитай отново.", {
        id: HOME_VIEW_TOAST_ID,
      });
      return;
    }
    toast.success(`При следващото отваряне на ${APP_NAME} ще виждаш „${label}“.`, {
      id: HOME_VIEW_TOAST_ID,
    });
  }, [preferredLandingView, setPreferredLandingView]);

  const zoneLocalities = useMemo(() => {
    if (
      effectiveViewMode !== "zones" ||
      !interestsLoaded ||
      interests.length === 0
    ) {
      return [];
    }

    return [
      ...new Set(
        messages
          .filter((message) => message.cityWide)
          .map((message) => message.locality),
      ),
    ];
  }, [effectiveViewMode, interestsLoaded, interests.length, messages]);
  const {
    boundaries: localityBoundaries,
    isLoading: boundariesLoading,
    error: boundariesError,
  } = useLocalityBoundaries(zoneLocalities);

  const scopedMessages = useMemo(() => {
    if (isLandingPending || !nearbyReady) {
      return [];
    }

    if (effectiveViewMode !== "zones") {
      return messages;
    }

    if (!interestsLoaded) {
      return [];
    }

    return filterEventsByZones(messages, interests, localityBoundaries);
  }, [
    isLandingPending,
    nearbyReady,
    effectiveViewMode,
    messages,
    interestsLoaded,
    interests,
    localityBoundaries,
  ]);
  const isViewLoading =
    isLandingPending ||
    isLoading ||
    (effectiveViewMode === "nearby" &&
      (nearbyLocation.status === "idle" || nearbyLocation.status === "loading")) ||
    (effectiveViewMode === "zones" && (!interestsLoaded || boundariesLoading));
  const viewError =
    error ?? (effectiveViewMode === "zones" ? boundariesError : null);

  // Category filtering hook (manages UI state and category selection)
  const categoryFilter = useCategoryFilter(
    availableCategories,
    scopedMessages,
    setSelectedCategories,
  );

  // Source filtering hook (manages UI state and source selection)
  const sourceFilter = useSourceFilter(
    scopedMessages,
    categoryFilter.showArchived,
    setSelectedSources,
  );

  const filteredMessages = useMemo(() => {
    if (categoryFilter.showArchived) {
      return scopedMessages;
    }

    return scopedMessages.filter(
      (message) => classifyMessage(message) === "active",
    );
  }, [scopedMessages, categoryFilter.showArchived]);

  // Map navigation and centering
  const {
    initialMapCenter,
    centerMapFn,
    mapInstance,
    handleMapReady,
    handleAddressClick,
  } = useMapNavigation();

  // Message hover state for map highlight
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  // Onboarding state (lifted from MapContainer for proper DOM ordering)
  const [onboardingState, setOnboardingState] =
    React.useState<OnboardingState | null>(null);
  const [onboardingCallbacks, setOnboardingCallbacks] = React.useState<{
    onPermissionResult: (permission: NotificationPermission) => void;
    onDismiss: () => void;
    onAddInterests: () => void;
  } | null>(null);

  const handleOnboardingStateChange = useCallback(
    (
      state: OnboardingState,
      callbacks: {
        onPermissionResult: (permission: NotificationPermission) => void;
        onDismiss: () => void;
        onAddInterests: () => void;
      },
    ) => {
      setOnboardingState(state);
      setOnboardingCallbacks(callbacks);
    },
    [],
  );

  const [pendingGuestUpgradeUid, setPendingGuestUpgradeUid] = useState<
    string | null
  >(null);
  const [isApplyingUpgradeOption, setIsApplyingUpgradeOption] = useState(false);

  const clearPendingGuestUpgradeSession = useCallback(() => {
    globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_UID_KEY);
    globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_TOKEN_KEY);
  }, []);

  useEffect(() => {
    if (!user || user.isAnonymous || globalThis.sessionStorage === undefined) {
      return;
    }

    const guestUid = globalThis.sessionStorage.getItem(
      PENDING_GUEST_UPGRADE_UID_KEY,
    );
    const guestToken = globalThis.sessionStorage.getItem(
      PENDING_GUEST_UPGRADE_TOKEN_KEY,
    );

    if (!guestUid) {
      return;
    }

    if (guestUid === user.uid) {
      clearPendingGuestUpgradeSession();
      return;
    }

    if (!guestToken) {
      clearPendingGuestUpgradeSession();
      return;
    }

    let canceled = false;

    void (async () => {
      let shouldClearPendingKeysOnError = true;

      try {
        const idToken = await user.getIdToken();
        const response = await fetch(
          `/api/auth/upgrade?guestUserId=${encodeURIComponent(guestUid)}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
              "X-Guest-Token": guestToken,
            },
          },
        );

        if (!response.ok) {
          clearPendingGuestUpgradeSession();
          return;
        }

        const data: {
          requiresDecision?: boolean;
          hasGuestData?: boolean;
          hasAccountData?: boolean;
        } = await response.json();

        if (canceled) {
          return;
        }

        if (data.requiresDecision) {
          setPendingGuestUpgradeUid(guestUid);
          trackEvent({ name: "upgrade_prompt_shown", params: {} });
          return;
        }

        if (data.hasGuestData && !data.hasAccountData) {
          shouldClearPendingKeysOnError = false;

          const importResponse = await fetch("/api/auth/upgrade", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
              "X-Guest-Token": guestToken,
            },
            body: JSON.stringify({
              guestUserId: guestUid,
              option: "import" satisfies UpgradeDecisionOption,
            }),
          });

          if (!importResponse.ok) {
            throw new Error("Automatic guest data import failed");
          }

          shouldClearPendingKeysOnError = true;
        }

        clearPendingGuestUpgradeSession();
      } catch (error) {
        console.error("Failed to evaluate guest upgrade state:", error);
        if (shouldClearPendingKeysOnError) {
          clearPendingGuestUpgradeSession();
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [clearPendingGuestUpgradeSession, user]);

  const handleUpgradeOptionSelect = useCallback(
    async (option: UpgradeDecisionOption) => {
      if (!user || !pendingGuestUpgradeUid) {
        return;
      }

      setIsApplyingUpgradeOption(true);
      trackEvent({
        name: "upgrade_option_selected",
        params: { option },
      });

      try {
        const idToken = await user.getIdToken();
        const guestToken = globalThis.sessionStorage.getItem(
          PENDING_GUEST_UPGRADE_TOKEN_KEY,
        );

        if (!guestToken) {
          throw new Error("Missing guest proof token");
        }

        const response = await fetch("/api/auth/upgrade", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
            "X-Guest-Token": guestToken,
          },
          body: JSON.stringify({
            guestUserId: pendingGuestUpgradeUid,
            option,
          }),
        });

        if (!response.ok) {
          throw new Error("Upgrade action failed");
        }

        trackEvent({
          name: "upgrade_outcome",
          params: { option, status: "success" },
        });

        if (globalThis.sessionStorage !== undefined) {
          clearPendingGuestUpgradeSession();
        }

        setPendingGuestUpgradeUid(null);
        toast.success("Данните бяха обработени успешно.");
      } catch (error) {
        console.error("Failed to resolve upgrade choice:", error);
        trackEvent({
          name: "upgrade_outcome",
          params: { option, status: "failure" },
        });
        toast.error("Неуспешна обработка. Няма промени в текущото състояние.");
      } finally {
        setIsApplyingUpgradeOption(false);
      }
    },
    [clearPendingGuestUpgradeSession, user, pendingGuestUpgradeUid],
  );

  // Interest/zone management
  const {
    targetMode,
    pendingNewInterest,
    pendingDeleteInterest,
    isDeletingInterest,
    selectedInterest,
    interestMenuPosition,
    handleInterestClick,
    handleMoveInterest,
    handleDeleteInterest,
    handleConfirmDeleteInterest,
    handleCancelDeleteInterest,
    handleStartAddInterest,
    handleSaveInterest,
    handleConfirmPendingInterest,
    handleCancelPendingInterest,
    handleCancelTargetMode,
    handleCloseInterestMenu,
  } = useInterestManagement(
    centerMapFn,
    mapInstance,
    addInterest,
    updateInterest,
    deleteInterest,
  );

  // Close the filter panel when zone creation mode becomes active
  const { closePanelSilently: closeFilterPanelSilently } = categoryFilter;
  useEffect(() => {
    if (targetMode.active) {
      closeFilterPanelSilently();
    }
  }, [targetMode.active, closeFilterPanelSilently]);

  // Handle feature click - update URL and select message
  const handleFeatureClick = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (message?.id) {
        // Update URL for the selected message using its canonical URL
        router.push(createMessageUrl(message), { scroll: false });
      }
    },
    [messages, router],
  );

  // Handle closing detail view
  const handleCloseDetail = useCallback(() => {
    navigateBackOrReplace(router, "/");
  }, [router]);

  useZoneMapFit({
    active: effectiveViewMode === "zones",
    interests,
    interestsLoaded,
    map: mapInstance,
    suspended: Boolean(messageId || targetMode.active),
    onBeforeFit: closeFilterPanelSilently,
    userId: user?.uid,
  });

  const viewportMatch = useMemo(
    () => messages.find((m) => m.id === messageId) ?? null,
    [messageId, messages],
  );

  const selectedMessage = useMessageByIdFallback(messageId, viewportMatch);

  // Both layouts use the same view selection and saved landing behavior.
  const viewModeOptions = user ? VIEW_MODE_OPTIONS : VIEW_MODE_OPTIONS_NO_USER;

  const sidebarHeaderContent = useMemo(() => {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={viewModeOptions}
          value={effectiveViewMode}
          onChange={handleViewChange}
          homeValue={preferredLandingView ?? "all"}
          onHomeChange={preferenceLoading ? undefined : handleHomeChange}
        />
        {user && effectiveViewMode === "zones" && (
          <button
            type="button"
            onClick={() => handleStartAddInterest()}
            disabled={targetMode.active}
            className={`${buttonSizes.sm} ${buttonStyles.primary} ${borderRadius.sm} flex items-center gap-1.5 shrink-0`}
            aria-label="Добави зона"
          >
            <PlusIcon className="w-4 h-4" />
            Добави зона
          </button>
        )}
      </div>
    );
  }, [
    user,
    effectiveViewMode,
    viewModeOptions,
    handleStartAddInterest,
    targetMode.active,
    handleViewChange,
    handleHomeChange,
    preferredLandingView,
    preferenceLoading,
  ]);

  const handleAddZoneConfirm = useCallback(
    (zone: PendingZone) => {
      handleConfirmPendingInterest(zone);
    },
    [handleConfirmPendingInterest],
  );

  // Center the map on a zone when clicked in the zone list
  const handleZoneClick = useCallback(
    (interest: Interest) => {
      if (centerMapFn) {
        centerMapFn(interest.coordinates.lat, interest.coordinates.lng, 16, {
          animate: true,
        });
      }
    },
    [centerMapFn],
  );

  // Track the last message we centered on to avoid re-centering loops
  const lastCenteredMessageIdRef = useRef<string | null>(null);

  // Center map on selected message's geometry when detail view opens (only once per message)
  useEffect(() => {
    // Require only selected message geometry and a ready map instance for bounds fitting.
    if (!selectedMessage?.id || !selectedMessage.geoJson || !mapInstance) {
      return;
    }

    // Skip if we've already centered on this message
    if (lastCenteredMessageIdRef.current === selectedMessage.id) {
      return;
    }

    const bounds = getFeaturesBounds(selectedMessage.geoJson);
    if (bounds) {
      const mapBounds = new google.maps.LatLngBounds(
        { lat: bounds.south, lng: bounds.west },
        { lat: bounds.north, lng: bounds.east },
      );

      suppressNextViewportFetch();
      mapInstance.fitBounds(mapBounds, MESSAGE_FIT_BOUNDS_PADDING_PX);
      lastCenteredMessageIdRef.current = selectedMessage.id;
      return;
    }

    const centroid = getFeaturesCentroid(selectedMessage.geoJson);
    if (centroid && handleAddressClick) {
      suppressNextViewportFetch();
      handleAddressClick(centroid.lat, centroid.lng);
      lastCenteredMessageIdRef.current = selectedMessage.id;
    }
  }, [
    selectedMessage,
    handleAddressClick,
    mapInstance,
    suppressNextViewportFetch,
  ]);

  // Reset centered message tracking when selection is cleared
  useEffect(() => {
    if (!selectedMessage) {
      lastCenteredMessageIdRef.current = null;
    }
  }, [selectedMessage]);

  return (
    <div className="flex-1 flex flex-col" ref={containerRef}>
      {/* Map and Messages Container - becomes flex-row on wide desktop */}
      <div className="flex-1 flex flex-col [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:flex-row">
        {/* Error messages */}
        {viewError && (
          <div
            className={`bg-white border-b shadow-sm ${zIndex.fixed} [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:absolute [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:top-0 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:left-0 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:right-0`}
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="p-4 bg-error-light text-error rounded-md">
                {viewError}
              </div>
            </div>
          </div>
        )}

        {/* Map Section - Left side on desktop, top on mobile */}
        <div
          className={`relative [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:w-3/5 h-[calc(66vh-64px)] [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:h-[calc(100vh-80px)] [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:sticky [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:top-0 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:self-start`}
        >
          {/* Filter Box */}
          <FilterBox
            isOpen={categoryFilter.isOpen}
            selectedCategories={categoryFilter.selectedCategories}
            selectedSources={sourceFilter.selectedSources}
            categoryCounts={categoryFilter.categoryCounts}
            sourceCounts={sourceFilter.sourceCounts}
            hasActiveFilters={
              categoryFilter.hasActiveFilters || sourceFilter.hasActiveFilters
            }
            hasActiveCategoryFilters={
              categoryFilter.selectedCategories &&
              categoryFilter.selectedCategories.size > 0
            }
            hasActiveSourceFilters={sourceFilter.hasActiveFilters}
            isInitialLoad={categoryFilter.isInitialLoad}
            isLoadingCounts={
              categoryFilter.isLoadingCounts || sourceFilter.isLoadingCounts
            }
            showArchived={categoryFilter.showArchived}
            onTogglePanel={categoryFilter.togglePanel}
            onToggleCategory={categoryFilter.toggleCategory}
            onToggleSource={sourceFilter.toggleSource}
            onToggleShowArchived={categoryFilter.toggleShowArchived}
            onClearAllFilters={() => {
              categoryFilter.clearAllCategories();
              sourceFilter.clearAllSources();
            }}
          />

          <MapContainer
            messages={filteredMessages}
            interests={interests}
            interestsLoaded={interestsLoaded}
            user={user}
            targetMode={targetMode}
            initialMapCenter={initialMapCenter}
            initialNavigationReady={!isLandingPending}
            navigationMode={effectiveViewMode}
            navigationSource={navigation.source}
            navigationRequestId={navigation.requestId}
            navigationSuspended={Boolean(
              messageId || (hasExplicitNavigation && navigation.source === "initial"),
            )}
            onLocationStateChange={handleLocationStateChange}
            hoveredMessageId={hoveredMessageId}
            selectedMessageId={selectedMessage?.id}
            onFeatureClick={handleFeatureClick}
            onMapReady={handleMapReady}
            onBoundsChanged={handleBoundsChanged}
            onInterestClick={
              isWideDesktopLayout ? undefined : handleInterestClick
            }
            interestsInteractive={!isWideDesktopLayout}
            onSaveInterest={handleSaveInterest}
            onCancelTargetMode={handleCancelTargetMode}
            onStartAddInterest={handleStartAddInterest}
            onOnboardingStateChange={handleOnboardingStateChange}
          />
          {isViewLoading && (
            <div
              className={`absolute top-4 left-1/2 transform -translate-x-1/2 bg-white px-4 py-2 rounded-lg shadow-md ${zIndex.nav}`}
            >
              <p className="text-sm text-neutral">Зареждане...</p>
            </div>
          )}
        </div>

        {/* Events Sidebar - Right side on desktop, bottom on mobile */}
        <div
          className={`flex-1 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:flex-none [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:w-2/5 bg-white overflow-y-auto ${selectedMessage ? "hidden sm:block" : ""}`}
        >
          <div className="p-4 sm:p-6 @container">
            <div className="mb-4">
              {sidebarHeaderContent}
            </div>

            {effectiveViewMode === "nearby" && (
              <div className="mb-4" aria-live="polite">
                <NearbyLocationStatus location={nearbyLocation} />
              </div>
            )}

            {user && effectiveViewMode === "zones" && (
              <div>
                <ZoneList
                  interests={interests}
                  onZoneClick={handleZoneClick}
                  onMoveZone={handleMoveInterest}
                  onDeleteZone={handleDeleteInterest}
                />
                {user?.isAnonymous && interests.length > 0 && (
                  <div className="mt-4 border border-neutral-border bg-neutral-light rounded-lg p-4">
                    <p className="text-neutral mb-3">
                      Влез с Google, за да запазиш зоните си и на други
                      устройства.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        trackEvent({
                          name: "login_initiated",
                          params: { source: "prompt" },
                        });
                        try {
                          await signInWithGoogle();
                        } catch {
                          toast.error("Неуспешно влизане. Опитай отново.");
                        }
                      }}
                      className={`${buttonSizes.sm} ${buttonStyles.ghost} ${borderRadius.sm}`}
                    >
                      Влез, за да запазиш
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Event cards follow the active view, below its zone controls. */}
            <section
              aria-label={getEventSectionLabel(effectiveViewMode)}
              className={
                effectiveViewMode === "zones"
                  ? "mt-6 border-t border-neutral-border pt-6"
                  : ""
              }
            >
              {effectiveViewMode === "zones" && (
                <h2 className="mb-4 text-base font-semibold text-foreground">
                  Събития в моите зони
                </h2>
              )}
              {(effectiveViewMode !== "nearby" || nearbyReady || isViewLoading) && (
                <MessagesGrid
                  messages={filteredMessages}
                  isLoading={isViewLoading}
                  onMessageClick={(message) => {
                    router.push(createMessageUrl(message), { scroll: false });
                  }}
                  onMessageHover={setHoveredMessageId}
                  variant="list"
                />
              )}
            </section>
          </div>
        </div>

        {/* End of Map and Messages Container */}
      </div>

      {/* Message Detail View */}
      <MessageDetailView
        key={messageId ?? "no-message"}
        message={selectedMessage}
        onClose={handleCloseDetail}
        onAddressClick={handleAddressClick}
      />

      {/* Interest Context Menu */}
      {!isWideDesktopLayout && interestMenuPosition && selectedInterest && (
        <InterestContextMenu
          position={interestMenuPosition}
          onMove={() => handleMoveInterest(selectedInterest)}
          onDelete={() => {
            handleDeleteInterest(selectedInterest);
          }}
          onClose={handleCloseInterestMenu}
        />
      )}

      {/* Onboarding Prompts - rendered at root for proper z-index stacking */}
      {onboardingState && onboardingCallbacks && (
        <OnboardingPrompt
          state={onboardingState}
          targetModeActive={targetMode.active}
          user={user}
          onPermissionResult={onboardingCallbacks.onPermissionResult}
          onDismiss={onboardingCallbacks.onDismiss}
          onAddInterests={() => {
            setViewMode("zones");
            onboardingCallbacks.onAddInterests();
          }}
        />
      )}

      {/* Add Zone Modal - opened from sidebar header */}
      {pendingNewInterest && (
        <AddZoneModal
          onConfirm={handleAddZoneConfirm}
          onCancel={handleCancelPendingInterest}
        />
      )}

      <ConfirmDialog
        isOpen={pendingDeleteInterest !== null}
        title="Наистина ли искаш да изтриеш зоната?"
        description={`Това действие ще изтрие зоната "${pendingDeleteInterest?.label?.trim() || "тази зона"}".`}
        confirmText="Изтрий зоната"
        isConfirming={isDeletingInterest}
        onConfirm={() => {
          void handleConfirmDeleteInterest();
        }}
        onCancel={handleCancelDeleteInterest}
      />

      {pendingGuestUpgradeUid && (
        <UpgradeConflictPrompt
          isLoading={isApplyingUpgradeOption}
          onSelect={(option) => {
            void handleUpgradeOptionSelect(option);
          }}
        />
      )}

    </div>
  );
}

export default function HomeContent() {
  return (
    <Suspense>
      <HomeContentInner />
    </Suspense>
  );
}
