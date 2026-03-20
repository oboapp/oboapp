"use client";

import React, {
  useCallback,
  useRef,
  useMemo,
  useState,
  useEffect,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MapContainer from "@/components/MapContainer";
import MessageDetailView from "@/components/MessageDetailView/MessageDetailView";
import MessagesGrid from "@/components/MessagesGrid";
import InterestContextMenu from "@/components/InterestContextMenu";
import FilterBox from "@/components/FilterBox";
import GeolocationPrompt from "@/components/GeolocationPrompt";
import OnboardingPrompt from "@/components/onboarding/OnboardingPrompt";
import UpgradeConflictPrompt from "@/components/onboarding/UpgradeConflictPrompt";
import AddZoneModal from "@/components/onboarding/AddZoneModal";
import type { PendingZone } from "@/components/onboarding/AddZoneModal";
import SegmentedControl from "@/components/SegmentedControl";
import ZoneBadges from "@/components/ZoneBadges";
import ZoneList from "@/components/ZoneList";
import { useInterests } from "@/lib/hooks/useInterests";
import { useAuth } from "@/lib/auth-context";
import { useMessages } from "@/lib/hooks/useMessages";
import { useMapNavigation } from "@/lib/hooks/useMapNavigation";
import { useInterestManagement } from "@/lib/hooks/useInterestManagement";
import { useCategoryFilter } from "@/lib/hooks/useCategoryFilter";
import { useSourceFilter } from "@/lib/hooks/useSourceFilter";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { classifyMessage } from "@/lib/message-classification";
import { createMessageUrl } from "@/lib/url-utils";
import { getFeaturesCentroid } from "@/lib/geometry-utils";
import { zIndex } from "@/lib/colors";
import { buttonStyles, buttonSizes, borderRadius } from "@/lib/theme";
import PlusIcon from "@/components/icons/PlusIcon";
import { navigateBackOrReplace } from "@/lib/navigation-utils";
import { trackEvent } from "@/lib/analytics";
import {
  PENDING_GUEST_UPGRADE_UID_KEY,
  PENDING_GUEST_UPGRADE_TOKEN_KEY,
  type UpgradeDecisionOption,
} from "@/lib/auth-upgrade";
import type { Interest } from "@/lib/types";
import type { OnboardingState } from "@/lib/hooks/useOnboardingFlow";
import { useMessageByIdFallback } from "@/lib/hooks/useMessageByIdFallback";

type ViewMode = "zones" | "events";
const WIDE_DESKTOP_MEDIA_QUERY =
  "(min-width: 1280px) and (min-aspect-ratio: 4/3)";

const VIEW_MODE_OPTIONS = [
  { value: "events" as const, label: "Събития" },
  { value: "zones" as const, label: "Моите зони" },
] as const;

const VIEW_MODE_OPTIONS_NO_USER = [
  { value: "events" as const, label: "Събития" },
  { value: "zones" as const, label: "Моите зони", disabled: true },
] as const;

/**
 * HomeContent - Main application component managing map, messages, and user interactions
 *
 * Loading and Initialization Flow:
 * 1. Component mounts with isLoading=false, map renders immediately
 * 2. Map loads and triggers onBoundsChanged when ready
 * 3. handleBoundsChanged sets viewportBounds after 300ms debounce
 * 4. Effect detects viewportBounds change and calls fetchMessages(viewportBounds)
 * 5. fetchMessages sets isLoading=true, shows loading indicator
 * 6. When fetch completes, isLoading=false, loading indicator disappears
 *
 * This ensures the map is visible immediately while messages load based on viewport.
 */
export default function HomeContent() {
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
  const { user, signInWithGoogle } = useAuth();
  const isWideDesktopLayout = useMediaQuery(WIDE_DESKTOP_MEDIA_QUERY);

  // Message fetching and viewport management
  const {
    messages,
    availableCategories,
    isLoading,
    error,
    handleBoundsChanged,
    suppressNextViewportFetch,
    setSelectedCategories,
    setSelectedSources,
  } = useMessages();

  // Category filtering hook (manages UI state and category selection)
  const categoryFilter = useCategoryFilter(
    availableCategories,
    messages, // Pass all messages initially - we'll filter within the hook
    setSelectedCategories,
  );

  // Source filtering hook (manages UI state and source selection)
  const sourceFilter = useSourceFilter(
    messages,
    categoryFilter.showArchived,
    setSelectedSources,
  );

  // Filter archived messages based on toggle state
  const filteredMessages = useMemo(() => {
    if (categoryFilter.showArchived) {
      return messages; // Show all messages
    }
    // Filter out archived messages
    return messages.filter((message) => classifyMessage(message) === "active");
  }, [messages, categoryFilter.showArchived]);

  // Map navigation and centering
  const {
    initialMapCenter,
    centerMapFn,
    mapInstance,
    handleMapReady,
    handleAddressClick,
  } = useMapNavigation();

  // Geolocation prompt state (lifted from MapContainer for proper DOM ordering)
  const [geolocationPrompt, setGeolocationPrompt] = React.useState<{
    show: boolean;
    onAccept: () => void;
    onDecline: () => void;
  } | null>(null);

  // Message hover state for map highlight
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  // View mode for the sidebar: "zones" (my zones) or "events" (all)
  const [viewMode, setViewMode] = useState<ViewMode>("events");
  const effectiveViewMode = user ? viewMode : "events";
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

    (async () => {
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
        alert("Данните бяха обработени успешно.");
      } catch (error) {
        console.error("Failed to resolve upgrade choice:", error);
        trackEvent({
          name: "upgrade_outcome",
          params: { option, status: "failure" },
        });
        alert("Неуспешна обработка. Няма промени в текущото състояние.");
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
    selectedInterest,
    interestMenuPosition,
    handleInterestClick,
    handleMoveInterest,
    handleDeleteInterest,
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

  // Derive selected message from URL parameter
  // Note: We search in unfiltered 'messages' to preserve selection even when filtered out
  const messageId = searchParams.get("messageId");

  const viewportMatch = useMemo(
    () => messages.find((m) => m.id === messageId) ?? null,
    [messageId, messages],
  );

  const selectedMessage = useMessageByIdFallback(messageId, viewportMatch);

  // Sidebar header with segmented control (shown for all users on desktop)
  const viewModeOptions = user ? VIEW_MODE_OPTIONS : VIEW_MODE_OPTIONS_NO_USER;

  const sidebarHeaderContent = useMemo(() => {
    return (
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl
          options={viewModeOptions}
          value={effectiveViewMode}
          onChange={(v) => {
            const mode = v === "zones" || v === "events" ? v : "events";
            setViewMode(mode);
          }}
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
    // Require a selected message with valid id, geometry and a ready map/navigation handler
    if (
      !selectedMessage?.id ||
      !selectedMessage.geoJson ||
      !handleAddressClick ||
      !centerMapFn ||
      !mapInstance
    ) {
      return;
    }

    // Skip if we've already centered on this message
    if (lastCenteredMessageIdRef.current === selectedMessage.id) return;

    const centroid = getFeaturesCentroid(selectedMessage.geoJson);
    if (centroid) {
      suppressNextViewportFetch();
      handleAddressClick(centroid.lat, centroid.lng);
      lastCenteredMessageIdRef.current = selectedMessage.id;
    }
  }, [
    selectedMessage,
    handleAddressClick,
    centerMapFn,
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
        {error && (
          <div
            className={`bg-white border-b shadow-sm ${zIndex.fixed} [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:absolute [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:top-0 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:left-0 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:right-0`}
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="p-4 bg-error-light text-error rounded-md">
                {error}
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
            onGeolocationPromptChange={setGeolocationPrompt}
            onOnboardingStateChange={handleOnboardingStateChange}
          />
          {isLoading && (
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
          <div className="p-6 @container">
            {/* Mobile: zone badges + always messages */}
            {user && (
              <div className="mb-4 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:hidden">
                <ZoneBadges
                  interests={interests}
                  onAddZone={handleStartAddInterest}
                  addZoneDisabled={targetMode.active}
                  onZoneClick={handleZoneClick}
                />
              </div>
            )}

            {/* Desktop: segmented control header */}
            <div className="mb-4 hidden [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:block">
              {sidebarHeaderContent}
            </div>

            {/* Desktop: zone list when in zones view mode */}
            {user && effectiveViewMode === "zones" && (
              <div className="hidden [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:block">
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
                          globalThis.alert("Неуспешно влизане. Опитай отново.");
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

            {/* Messages: always visible on mobile, conditional on desktop */}
            <div
              className={
                user && effectiveViewMode === "zones"
                  ? "[@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:hidden"
                  : ""
              }
            >
              <MessagesGrid
                messages={filteredMessages}
                isLoading={isLoading}
                onMessageClick={(message) => {
                  router.push(createMessageUrl(message), { scroll: false });
                }}
                onMessageHover={setHoveredMessageId}
                variant="list"
              />
            </div>
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
            void handleDeleteInterest(selectedInterest);
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

      {pendingGuestUpgradeUid && (
        <UpgradeConflictPrompt
          isLoading={isApplyingUpgradeOption}
          onSelect={(option) => {
            void handleUpgradeOptionSelect(option);
          }}
        />
      )}

      {/* Geolocation Prompt - rendered last for proper z-index stacking */}
      {geolocationPrompt?.show && (
        <GeolocationPrompt
          onAccept={geolocationPrompt.onAccept}
          onDecline={geolocationPrompt.onDecline}
        />
      )}
    </div>
  );
}
