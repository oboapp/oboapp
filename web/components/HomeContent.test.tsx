import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import HomeContent from "@/components/HomeContent";
import { toast } from "sonner";
import {
  PENDING_GUEST_UPGRADE_UID_KEY,
  PENDING_GUEST_UPGRADE_TOKEN_KEY,
} from "@/lib/auth-upgrade";
import type { Interest, InternalMessage, Message } from "@/lib/types";
import type { LocalityBoundaries } from "@/lib/zone-event-filter";
import type { LandingView } from "@/lib/hooks/useLandingPreference";
import type { NearbyLocationState } from "@/components/MapContainer";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

let isWideDesktopLayout = false;
let mockMapInstance: google.maps.Map | null = null;
let mockInterestsLoaded = true;
let mockAuthLoading = false;
let mockPreferenceLoading = false;
let mockPreferredLandingView: LandingView | null = null;
const mockSetPreferredLandingView = vi.fn();
let mockSearchParams = new URLSearchParams();
let mockFeatureBounds: {
  north: number;
  south: number;
  east: number;
  west: number;
} | null = null;
let capturedMapContainerProps: Record<string, unknown> | null = null;
let capturedMessageQueryOptions: Record<string, unknown> | null = null;
let capturedZoneListProps: Record<string, unknown> | null = null;
let capturedMessagesGridProps: Record<string, unknown> | null = null;
let capturedFilterBoxProps: Record<string, unknown> | null = null;
let capturedCategoryMessages: Message[] = [];
let capturedSourceMessages: Message[] = [];
let mockMessages: InternalMessage[] = [];
let mockShowArchived = false;
let mockSelectedCategories = new Set<string>();
let mockSelectedSources = new Set<string>();
let mockLocalityBoundaries: LocalityBoundaries = {};
const mockHandleBoundsChanged = vi.fn();
const mockSuppressNextViewportFetch = vi.fn();
const mockResetViewport = vi.fn();
const mockCloseFilterPanelSilently = vi.fn();
const mockSetSelectedCategories = vi.fn();
const mockSetSelectedSources = vi.fn();
const mockZoneBoundsCenter = { lat: 42.6977, lng: 23.3219 };
let authUser: {
  uid: string;
  isAnonymous?: boolean;
  getIdToken?: () => Promise<string>;
} | null = null;

const initialInterests: Interest[] = [
  {
    id: "interest-1",
    userId: "user-1",
    coordinates: { lat: 42.6977, lng: 23.3219 },
    radius: 500,
    label: "Зона",
    color: "#F97316",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
];
let mockInterests = initialInterests;

function createMapMessage(
  id: string,
  coordinates: [number, number],
  overrides: Partial<InternalMessage> = {},
): InternalMessage {
  return {
    id,
    text: id,
    locality: "bg.sofia",
    createdAt: "2026-10-29T10:00:00.000Z",
    aiProcessed: true,
    categories: ["water"],
    source: "sofiyska-voda",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates },
        },
      ],
    },
    ...overrides,
  };
}

function expectDisplayedMessages(messages: InternalMessage[]) {
  expect(capturedMapContainerProps?.messages).toEqual(messages);
  expect(capturedMessagesGridProps?.messages).toEqual(messages);
}

const selectedInterestState = {
  targetMode: { active: false },
  pendingNewInterest: null,
  selectedInterest: {
    id: "interest-1",
    userId: "user-1",
    coordinates: { lat: 42.6977, lng: 23.3219 },
    radius: 500,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  interestMenuPosition: { x: 100, y: 200 },
  handleInterestClick: vi.fn(),
  handleMoveInterest: vi.fn(),
  handleDeleteInterest: vi.fn(),
  handleStartAddInterest: vi.fn(),
  handleSaveInterest: vi.fn(),
  handleConfirmPendingInterest: vi.fn(),
  handleCancelPendingInterest: vi.fn(),
  handleCancelTargetMode: vi.fn(),
  handleCloseInterestMenu: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/components/MapContainer", () => ({
  default: (props: Record<string, unknown>) => {
    capturedMapContainerProps = props;
    return <div data-testid="map-container" />;
  },
}));

vi.mock("@/components/MessageDetailView/MessageDetailView", () => ({
  default: () => <div data-testid="message-detail-view" />,
}));

vi.mock("@/components/MessagesGrid", () => ({
  default: (props: Record<string, unknown>) => {
    capturedMessagesGridProps = props;
    return <div data-testid="messages-grid" />;
  },
}));

vi.mock("@/components/InterestContextMenu", () => ({
  default: () => <div data-testid="interest-context-menu" />,
}));

vi.mock("@/components/FilterBox", () => ({
  default: (props: Record<string, unknown>) => {
    capturedFilterBoxProps = props;
    return <div data-testid="filter-box" />;
  },
}));

vi.mock("@/components/onboarding/OnboardingPrompt", () => ({
  default: () => <div data-testid="onboarding-prompt" />,
}));

vi.mock("@/components/onboarding/AddZoneModal", () => ({
  default: () => <div data-testid="add-zone-modal" />,
}));

vi.mock("@/components/ZoneList", () => ({
  default: (props: Record<string, unknown>) => {
    capturedZoneListProps = props;
    return <div data-testid="zone-list" />;
  },
}));

vi.mock("@/lib/hooks/useInterests", () => ({
  useInterests: () => ({
    interests: mockInterests,
    hasInitialized: mockInterestsLoaded,
    addInterest: vi.fn(),
    updateInterest: vi.fn(),
    deleteInterest: vi.fn(),
  }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: authUser, loading: mockAuthLoading }),
}));

vi.mock("@/lib/hooks/useLandingPreference", () => ({
  useLandingPreference: () => ({
    preferredLandingView: mockPreferredLandingView,
    isLoading: mockPreferenceLoading,
    setPreferredLandingView: mockSetPreferredLandingView,
  }),
}));

vi.mock("@/lib/hooks/useMessages", () => ({
  useMessages: (options: Record<string, unknown>) => {
    capturedMessageQueryOptions = options;
    return {
      messages: mockMessages,
      availableCategories: [],
      isLoading: false,
      error: null,
      handleBoundsChanged: mockHandleBoundsChanged,
      suppressNextViewportFetch: mockSuppressNextViewportFetch,
      resetViewport: mockResetViewport,
      setSelectedCategories: mockSetSelectedCategories,
      setSelectedSources: mockSetSelectedSources,
    };
  },
}));

vi.mock("@/lib/hooks/useLocalityBoundaries", () => ({
  useLocalityBoundaries: () => ({
    boundaries: mockLocalityBoundaries,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/lib/hooks/useMapNavigation", () => ({
  useMapNavigation: () => ({
    initialMapCenter: null,
    centerMapFn: vi.fn(),
    mapInstance: mockMapInstance,
    handleMapReady: vi.fn(),
    handleAddressClick: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useInterestManagement", () => ({
  useInterestManagement: () => selectedInterestState,
}));

vi.mock("@/lib/hooks/useCategoryFilter", () => ({
  useCategoryFilter: (_categories: unknown, messages: Message[]) => {
    capturedCategoryMessages = messages;
    return {
      isOpen: false,
      selectedCategories: mockSelectedCategories,
      categoryCounts: new Map<string, number>(),
      hasActiveFilters: mockSelectedCategories.size > 0,
      isInitialLoad: false,
      isLoadingCounts: false,
      showArchived: mockShowArchived,
      togglePanel: vi.fn(),
      closePanelSilently: mockCloseFilterPanelSilently,
      toggleCategory: vi.fn(),
      toggleShowArchived: vi.fn(),
      clearAllCategories: vi.fn(),
    };
  },
}));

vi.mock("@/lib/hooks/useSourceFilter", () => ({
  useSourceFilter: (messages: Message[]) => {
    capturedSourceMessages = messages;
    return {
      selectedSources: mockSelectedSources,
      sourceCounts: new Map<string, number>(),
      hasActiveFilters: mockSelectedSources.size > 0,
      isLoadingCounts: false,
      toggleSource: vi.fn(),
      clearAllSources: vi.fn(),
    };
  },
}));

vi.mock("@/lib/hooks/useMediaQuery", () => ({
  useMediaQuery: () => isWideDesktopLayout,
}));

vi.mock("@/lib/message-classification", () => ({
  classifyMessage: (message: Message) => {
    return message.createdAt.startsWith("2025") ? "archived" : "active";
  },
}));

vi.mock("@/lib/url-utils", () => ({
  createMessageUrl: () => "/",
}));

vi.mock("@/lib/geometry-utils", () => ({
  getFeaturesBounds: () => mockFeatureBounds,
  getFeaturesCentroid: () => null,
}));

vi.mock("@/lib/navigation-utils", () => ({
  navigateBackOrReplace: vi.fn(),
}));

vi.mock("@oboapp/shared", async (importOriginal) => {
  const shared = await importOriginal<typeof import("@oboapp/shared")>();
  return {
    ...shared,
    isValidMessageId: () => true,
  };
});

describe("HomeContent pivot behavior", () => {
  beforeEach(() => {
    capturedMapContainerProps = null;
    capturedMessageQueryOptions = null;
    capturedZoneListProps = null;
    capturedMessagesGridProps = null;
    capturedFilterBoxProps = null;
    capturedCategoryMessages = [];
    capturedSourceMessages = [];
    mockMessages = [];
    mockInterests = initialInterests;
    mockShowArchived = false;
    mockSelectedCategories = new Set<string>();
    mockSelectedSources = new Set<string>();
    mockLocalityBoundaries = {};
    isWideDesktopLayout = false;
    mockMapInstance = null;
    mockInterestsLoaded = true;
    mockAuthLoading = false;
    mockPreferenceLoading = false;
    mockPreferredLandingView = null;
    mockSearchParams = new URLSearchParams();
    mockFeatureBounds = null;
    authUser = null;
    vi.clearAllMocks();
    mockSetPreferredLandingView.mockReturnValue(true);
    vi.unstubAllGlobals();
    vi.stubGlobal("google", {
      maps: {
        LatLngBounds: class {
          getCenter() {
            return mockZoneBoundsCenter;
          }
        },
      },
    });
    globalThis.sessionStorage.clear();
  });

  it("passes desktop-wide map wiring and hides mobile interest menu", () => {
    isWideDesktopLayout = true;

    render(<HomeContent />);

    expect(capturedMapContainerProps).not.toBeNull();
    expect(capturedMapContainerProps?.interestsInteractive).toBe(false);
    expect(capturedMapContainerProps?.onInterestClick).toBeUndefined();
    expect(
      screen.queryByTestId("interest-context-menu"),
    ).not.toBeInTheDocument();
  });

  it("passes mobile map wiring and renders interest menu when selection exists", () => {
    isWideDesktopLayout = false;

    render(<HomeContent />);

    expect(capturedMapContainerProps).not.toBeNull();
    expect(capturedMapContainerProps?.interestsInteractive).toBe(true);
    expect(capturedMapContainerProps?.onInterestClick).toEqual(
      expect.any(Function),
    );
    expect(screen.getByTestId("interest-context-menu")).toBeInTheDocument();
  });

  it("keeps tab changes temporary and saves only from the house on the active tab", () => {
    authUser = { uid: "user-1" };
    mockPreferredLandingView = "all";
    const { rerender } = render(<HomeContent />);
    expect(screen.getByRole("button", { name: "Информация за началния изглед „Всички“" })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expect(mockSetPreferredLandingView).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Направи „Моите зони“ начален изглед" }));
    expect(mockSetPreferredLandingView).toHaveBeenCalledExactlyOnceWith("zones");
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "При следващото отваряне на OboApp ще виждаш „Моите зони“.",
      { id: "home-view-preference" },
    );
    expect(capturedMapContainerProps?.navigationMode).toBe("zones");

    mockPreferredLandingView = "zones";
    rerender(<HomeContent />);
    expect(screen.getByRole("button", { name: "Информация за началния изглед „Моите зони“" })).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
    expect(screen.getByRole("button", { name: "Направи „Всички“ начален изглед" })).not.toHaveAttribute("aria-disabled");
    expect(mockSetPreferredLandingView).toHaveBeenCalledTimes(1);
  });

  it.each([
    { preference: null, label: "Всички" },
    { preference: "all", label: "Всички" },
    { preference: "nearby", label: "Около мен" },
    { preference: "zones", label: "Моите зони" },
  ] as const)("explains the current home without saving for preference=$preference", ({ preference, label }) => {
    authUser = { uid: "user-1" };
    mockPreferredLandingView = preference;
    render(<HomeContent />);

    fireEvent.click(screen.getByRole("button", {
      name: `Информация за началния изглед „${label}“`,
    }));

    expect(mockSetPreferredLandingView).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledExactlyOnceWith(
      `„${label}“ е началният ти изглед в OboApp.`,
      { id: "home-view-preference" },
    );
  });

  it("keeps the previous home and only reports an error when saving fails", () => {
    authUser = { uid: "user-1" };
    mockPreferredLandingView = "all";
    mockSetPreferredLandingView.mockReturnValue(false);
    render(<HomeContent />);

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    fireEvent.click(screen.getByRole("button", { name: "Направи „Моите зони“ начален изглед" }));

    expect(mockSetPreferredLandingView).toHaveBeenCalledExactlyOnceWith("zones");
    expect(screen.getByRole("button", { name: "Направи „Моите зони“ начален изглед" })).toBeEnabled();
    expect(capturedMapContainerProps?.navigationMode).toBe("zones");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Началният изглед не се запази. Опитай отново.",
      { id: "home-view-preference" },
    );
  });

  it("keeps Nearby permission and retry actions in the list without showing unrelated events", () => {
    authUser = { uid: "user-1" };
    mockMessages = [createMapMessage("old-city-event", [23.38, 42.65])];
    render(<HomeContent />);

    fireEvent.click(screen.getByRole("radio", { name: "Около мен" }));
    expect(capturedMapContainerProps).toMatchObject({
      navigationMode: "nearby",
      navigationSource: "manual",
      navigationRequestId: 1,
    });
    expect(mockResetViewport).toHaveBeenCalledOnce();
    expect(capturedMessageQueryOptions?.enabled).toBe(false);
    expectDisplayedMessages([]);
    const retry = vi.fn();
    const updateLocation = capturedMapContainerProps?.onLocationStateChange as (state: NearbyLocationState) => void;
    act(() => {
      updateLocation({ status: "permission-required", message: "Нужен е достъп до местоположението.", retry });
    });
    expect(screen.queryByTestId("messages-grid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Разреши местоположение" }));
    expect(retry).toHaveBeenCalledOnce();

    act(() => {
      updateLocation({ status: "loading", message: null, retry });
    });
    expect(mockResetViewport).toHaveBeenCalledTimes(2);
    act(() => {
      updateLocation({ status: "ready", message: null, retry });
    });
    expect(capturedMessageQueryOptions?.enabled).toBe(true);
    expect(screen.getByTestId("messages-grid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Обнови местоположението" }));
    expect(retry).toHaveBeenCalledTimes(2);
    expect(mockSetPreferredLandingView).not.toHaveBeenCalled();

    act(() => {
      updateLocation({ status: "error", message: "Неуспешно определяне на местоположението.", retry });
    });
    expect(screen.getByRole("button", { name: "Опитай отново" })).toBeVisible();
    expect(screen.queryByTestId("messages-grid")).not.toBeInTheDocument();
    expect(capturedCategoryMessages).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
    expect(capturedMessageQueryOptions?.enabled).toBe(true);
    expect(mockResetViewport).toHaveBeenCalledTimes(2);
  });

  it("starts a saved Nearby home without making an explicit location request", () => {
    mockPreferredLandingView = "nearby";
    render(<HomeContent />);
    expect(capturedMapContainerProps).toMatchObject({
      navigationMode: "nearby",
      navigationSource: "initial",
      navigationRequestId: 0,
    });
    expect(capturedMessageQueryOptions?.enabled).toBe(false);
    expect(screen.getByRole("button", { name: "Информация за началния изглед „Около мен“" })).toBeEnabled();
  });

  it.each([false, true])(
    "opens the saved zones view with filtering and fitting for wide layout=%s",
    (wideLayout) => {
      isWideDesktopLayout = wideLayout;
      authUser = { uid: "user-1" };
      mockPreferredLandingView = "zones";
      const inside = createMapMessage("inside", [23.3219, 42.6977]);
      mockMessages = [inside, createMapMessage("outside", [23.38, 42.65])];
      const fitBounds = vi.fn();
      mockMapInstance = { fitBounds, setCenter: vi.fn() } as unknown as google.maps.Map;

      render(<HomeContent />);

      expectDisplayedMessages([inside]);
      expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: true });
      expect(capturedMapContainerProps?.initialNavigationReady).toBe(true);
      expect(capturedMapContainerProps?.navigationMode).not.toBe("nearby");
      expect(screen.getByTestId("zone-list")).toBeVisible();
      expect(fitBounds).toHaveBeenCalledTimes(1);
      expect(mockSetPreferredLandingView).not.toHaveBeenCalled();
    },
  );

  it.each([null, "all"] as const)(
    "keeps usual Events behavior for saved preference=%s",
    (preference) => {
      authUser = { uid: "user-1" };
      mockPreferredLandingView = preference;
      mockMessages = [createMapMessage("outside", [23.38, 42.65])];

      render(<HomeContent />);

      expectDisplayedMessages(mockMessages);
      expect(capturedMessageQueryOptions).toEqual({ scope: "viewport", enabled: true });
      expect(capturedMapContainerProps?.navigationMode).toBe("all");
      expect(mockSetPreferredLandingView).not.toHaveBeenCalled();
    },
  );

  it.each([null, "all"] as const)(
    "opens All without waiting for account or zones for preference=%s",
    (preference) => {
      mockPreferredLandingView = preference;
      mockAuthLoading = true;
      mockInterestsLoaded = false;
      mockMessages = [createMapMessage("public-event", [23.38, 42.65])];

      const { rerender } = render(<HomeContent />);

      expect(capturedMapContainerProps?.initialNavigationReady).toBe(true);
      expect(capturedMapContainerProps?.navigationMode).toBe("all");
      expect(capturedMessageQueryOptions).toEqual({ scope: "viewport", enabled: true });
      expectDisplayedMessages(mockMessages);
      expect(mockSetPreferredLandingView).not.toHaveBeenCalled();

      authUser = { uid: "user-1" };
      mockAuthLoading = false;
      rerender(<HomeContent />);
      expect(capturedMapContainerProps?.navigationMode).toBe("all");
      expect(capturedMessageQueryOptions?.enabled).toBe(true);
    },
  );

  it("waits for preference, authentication, zones, and map for a saved zones home", () => {
    mockAuthLoading = true;
    mockPreferenceLoading = true;
    mockInterestsLoaded = false;
    mockMessages = [createMapMessage("outside", [23.38, 42.65])];
    const { rerender } = render(<HomeContent />);
    expectDisplayedMessages([]);
    expect(capturedMessageQueryOptions?.enabled).toBe(false);
    expect(capturedMapContainerProps?.initialNavigationReady).toBe(false);
    expect(capturedMapContainerProps?.navigationMode).not.toBe("nearby");

    mockAuthLoading = false;
    authUser = { uid: "user-1" };
    rerender(<HomeContent />);
    expect(capturedMessageQueryOptions?.enabled).toBe(false);

    mockPreferenceLoading = false;
    mockPreferredLandingView = "zones";
    rerender(<HomeContent />);
    expect(capturedMessageQueryOptions?.enabled).toBe(false);
    expect(capturedMapContainerProps?.initialNavigationReady).toBe(false);

    mockInterestsLoaded = true;
    rerender(<HomeContent />);
    expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: true });
    expect(capturedMapContainerProps?.initialNavigationReady).toBe(true);

    const fitBounds = vi.fn();
    mockMapInstance = { fitBounds, setCenter: vi.fn() } as unknown as google.maps.Map;
    rerender(<HomeContent />);
    expect(fitBounds).toHaveBeenCalledTimes(1);
    rerender(<HomeContent />);
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("keeps a temporary tab choice when a delayed preference arrives", () => {
    authUser = { uid: "user-1" };
    mockPreferenceLoading = true;
    const { rerender } = render(<HomeContent />);

    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
    mockPreferenceLoading = false;
    mockPreferredLandingView = "zones";
    rerender(<HomeContent />);

    expect(capturedMessageQueryOptions).toEqual({ scope: "viewport", enabled: true });
    expect(screen.queryByTestId("zone-list")).not.toBeInTheDocument();
    expect(mockSetPreferredLandingView).not.toHaveBeenCalled();
  });

  it("keeps the visit choice while preferences change and reapplies the saved choice on return", () => {
    authUser = { uid: "user-1" };
    mockPreferredLandingView = "zones";
    const firstVisit = render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
    firstVisit.rerender(<HomeContent />);
    expect(capturedMessageQueryOptions?.scope).toBe("viewport");
    expect(mockSetPreferredLandingView).not.toHaveBeenCalled();
    firstVisit.unmount();

    const nextVisit = render(<HomeContent />);
    expect(capturedMessageQueryOptions?.scope).toBe("all");
    mockPreferredLandingView = "all";
    nextVisit.rerender(<HomeContent />);
    expect(capturedMessageQueryOptions?.scope).toBe("all");
    nextVisit.unmount();

    render(<HomeContent />);
    expect(capturedMessageQueryOptions?.scope).toBe("viewport");
  });

  it("opens the add-zone empty state for a saved zones preference without zones", () => {
    authUser = { uid: "user-1" };
    mockPreferredLandingView = "zones";
    mockInterests = [];
    const fitBounds = vi.fn();
    mockMapInstance = { fitBounds, setCenter: vi.fn() } as unknown as google.maps.Map;

    render(<HomeContent />);

    expectDisplayedMessages([]);
    expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: false });
    expect(capturedZoneListProps?.interests).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Добави зона" }));
    expect(selectedInterestState.handleStartAddInterest).toHaveBeenCalledOnce();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("keeps Events usable when authentication settles without a user", () => {
    mockAuthLoading = true;
    mockPreferredLandingView = "zones";
    const { rerender } = render(<HomeContent />);
    expect(capturedMessageQueryOptions?.enabled).toBe(false);

    mockAuthLoading = false;
    rerender(<HomeContent />);

    expect(capturedMessageQueryOptions).toEqual({ scope: "viewport", enabled: true });
    expect(capturedMapContainerProps?.navigationMode).toBe("all");
    expect(screen.getByRole("radio", { name: "Моите зони" })).toHaveAttribute("aria-disabled", "true");
    expect(mockSetPreferredLandingView).not.toHaveBeenCalled();
  });

  it.each(["messageId=selected", "lat=42.7&lng=23.3"])(
    "preserves explicit navigation instead of the saved zones landing for %s",
    (query) => {
      authUser = { uid: "user-1" };
      mockPreferredLandingView = "zones";
      mockPreferenceLoading = true;
      mockInterestsLoaded = false;
      mockSearchParams = new URLSearchParams(query);
      mockMessages = [createMapMessage("selected", [23.3219, 42.6977])];
      const fitBounds = vi.fn();
      mockMapInstance = { fitBounds, setCenter: vi.fn() } as unknown as google.maps.Map;

      const { rerender } = render(<HomeContent />);
      expect(capturedMessageQueryOptions).toEqual({ scope: "viewport", enabled: true });
      expect(capturedMapContainerProps?.navigationMode).not.toBe("nearby");
      expect(fitBounds).not.toHaveBeenCalled();

      mockSearchParams = new URLSearchParams();
      mockPreferenceLoading = false;
      mockInterestsLoaded = true;
      rerender(<HomeContent />);
      expect(capturedMessageQueryOptions?.scope).toBe("viewport");
      expect(fitBounds).not.toHaveBeenCalled();
    },
  );

  it("fits after delayed zone loading and queries independently of the viewport", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockInterestsLoaded = false;
    const fitBounds = vi.fn();
    const setCenter = vi.fn();
    mockMapInstance = { fitBounds, setCenter } as unknown as google.maps.Map;
    const { rerender } = render(<HomeContent />);

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expect(fitBounds).not.toHaveBeenCalled();
    expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: false });
    expect(setCenter).not.toHaveBeenCalled();
    expect(capturedMapContainerProps?.navigationMode).not.toBe("nearby");

    mockInterestsLoaded = true;
    rerender(<HomeContent />);
    expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: true });
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(setCenter).toHaveBeenCalledExactlyOnceWith(mockZoneBoundsCenter);
    expect(fitBounds.mock.invocationCallOrder[0]).toBeLessThan(
      setCenter.mock.invocationCallOrder[0],
    );
    expect(mockCloseFilterPanelSilently).toHaveBeenCalledTimes(1);
    expect(mockCloseFilterPanelSilently.mock.invocationCallOrder[0]).toBeLessThan(
      fitBounds.mock.invocationCallOrder[0],
    );
    act(() => {
      const onBoundsChanged = capturedMapContainerProps?.onBoundsChanged as (
        bounds: { north: number; south: number; east: number; west: number; zoom: number },
      ) => void;
      onBoundsChanged({ north: 43, south: 42, east: 24, west: 23, zoom: 12 });
    });
    expect(mockHandleBoundsChanged).toHaveBeenCalledTimes(1);
    expect(mockSuppressNextViewportFetch).not.toHaveBeenCalled();

    mockMessages = [createMapMessage("refresh", [23.3219, 42.6977])];
    rerender(<HomeContent />);
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(setCenter).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
    expect(capturedMessageQueryOptions).toEqual({ scope: "viewport", enabled: true });
    expect(capturedMapContainerProps?.navigationMode).toBe("all");
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect(setCenter).toHaveBeenCalledTimes(2);
  });

  it("preserves the camera across layout changes and fits again on tab re-entry", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockInterests = [];
    const fitBounds = vi.fn();
    const setCenter = vi.fn();
    mockMapInstance = { fitBounds, setCenter } as unknown as google.maps.Map;
    const { rerender } = render(<HomeContent />);

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expect(fitBounds).not.toHaveBeenCalled();
    expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: false });
    expect(setCenter).not.toHaveBeenCalled();

    isWideDesktopLayout = false;
    rerender(<HomeContent />);
    mockInterests = initialInterests;
    isWideDesktopLayout = true;
    rerender(<HomeContent />);
    expect(fitBounds).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(setCenter).toHaveBeenCalledTimes(1);
  });

  it("preserves explicit event navigation when entering My zones", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockSearchParams = new URLSearchParams("messageId=selected");
    mockMessages = [createMapMessage("selected", [23.3219, 42.6977])];
    mockFeatureBounds = { north: 42.71, south: 42.69, east: 23.34, west: 23.31 };
    const createdBounds = { event: "bounds" };
    vi.stubGlobal("google", {
      maps: {
        LatLngBounds: class {
          constructor() {
            return createdBounds;
          }
        },
      },
    });
    const fitBounds = vi.fn();
    const setCenter = vi.fn();
    mockMapInstance = { fitBounds, setCenter } as unknown as google.maps.Map;

    render(<HomeContent />);
    expect(fitBounds).toHaveBeenCalledExactlyOnceWith(createdBounds, 56);
    expect(mockSuppressNextViewportFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(setCenter).not.toHaveBeenCalled();
    expect(capturedMapContainerProps?.navigationMode).not.toBe("nearby");
    expect(capturedMapContainerProps?.selectedMessageId).toBe("selected");
  });

  it("wires move/delete callbacks into ZoneList on authenticated desktop zones view", async () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };

    render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expect(capturedZoneListProps).not.toBeNull();
    expect(capturedZoneListProps?.onMoveZone).toEqual(expect.any(Function));
    expect(capturedZoneListProps?.onDeleteZone).toEqual(expect.any(Function));
  });

  it("scopes map, list, and filter counts to intersecting zones and restores Events", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    const inside = createMapMessage("inside", [23.3219, 42.6977]);
    const outside = createMapMessage("outside", [23.38, 42.65]);
    const crossing = createMapMessage("crossing", [23.28, 42.6977], {
      geoJson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [23.28, 42.6977],
                [23.33, 42.6977],
              ],
            },
          },
        ],
      },
    });
    mockMessages = [inside, outside, crossing];

    render(<HomeContent />);
    expectDisplayedMessages(mockMessages);

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expectDisplayedMessages([inside, crossing]);
    expect(capturedCategoryMessages).toEqual([inside, crossing]);
    expect(capturedSourceMessages).toEqual([inside, crossing]);
    expect(capturedMapContainerProps?.interests).toEqual(mockInterests);

    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));

    expectDisplayedMessages(mockMessages);
    expect(capturedCategoryMessages).toEqual(mockMessages);
    expect(capturedSourceMessages).toEqual(mockMessages);
  });

  it.each([false, true])(
    "shows matching event cards below saved zones for anonymous=%s",
    (isAnonymous) => {
      isWideDesktopLayout = true;
      authUser = { uid: "user-1", isAnonymous };
      const inside = createMapMessage("inside", [23.3219, 42.6977]);
      mockMessages = [inside, createMapMessage("outside", [23.38, 42.65])];

      render(<HomeContent />);
      fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

      const eventSection = screen.getByRole("region", {
        name: "Събития в моите зони",
      });
      expect(within(eventSection).getByTestId("messages-grid")).toBeVisible();
      expectDisplayedMessages([inside]);
      expect(
        screen.getByTestId("zone-list").compareDocumentPosition(eventSection) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      if (isAnonymous) {
        expect(
          screen.getByRole("button", { name: "Влез, за да запазиш" }),
        ).toBeVisible();
      }

      fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
      expect(
        screen.getByRole("region", { name: "Събития" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "Събития в моите зони" }),
      ).not.toBeInTheDocument();
    },
  );

  it("shows an event only once when duplicate results intersect overlapping zones", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockInterests = [
      ...initialInterests,
      {
        ...initialInterests[0],
        id: "overlapping-zone",
        coordinates: { lat: 42.698, lng: 23.322 },
      },
    ];
    const inside = createMapMessage("inside", [23.3219, 42.6977]);
    mockMessages = [inside, { ...inside }];

    render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expectDisplayedMessages([inside]);
    expect(capturedMapContainerProps?.interests).toHaveLength(2);
  });

  it("keeps all saved-zone matches available when panning away from them", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    const homeEvent = createMapMessage("home", [23.3219, 42.6977]);
    const workEvent = createMapMessage("work", [23.38, 42.65]);
    const outside = createMapMessage("outside", [23.5, 42.8]);
    mockInterests = [
      ...initialInterests,
      { ...initialInterests[0], id: "work", coordinates: { lat: 42.65, lng: 23.38 } },
    ];
    mockMessages = [homeEvent, workEvent, outside];

    const { rerender } = render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expectDisplayedMessages([homeEvent, workEvent]);
    expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: true });

    const bounds = {
      north: 42.81,
      south: 42.79,
      east: 23.51,
      west: 23.49,
      zoom: 16,
    };
    expect(capturedMapContainerProps?.onBoundsChanged).toBe(
      mockHandleBoundsChanged,
    );
    mockHandleBoundsChanged(bounds);
    rerender(<HomeContent />);

    expectDisplayedMessages([homeEvent, workEvent]);
    expect(capturedMessageQueryOptions).toEqual({ scope: "all", enabled: true });
    expect(capturedMapContainerProps?.interests).toEqual(mockInterests);
  });

  it("recomputes matches when saved zones move", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    const homeEvent = createMapMessage("home", [23.3219, 42.6977]);
    const workEvent = createMapMessage("work", [23.38, 42.65]);
    mockMessages = [homeEvent, workEvent];

    const { rerender } = render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expectDisplayedMessages([homeEvent]);

    mockInterests = [
      {
        ...initialInterests[0],
        coordinates: { lat: 42.65, lng: 23.38 },
      },
    ];
    rerender(<HomeContent />);

    expectDisplayedMessages([workEvent]);
    expect(capturedMapContainerProps?.interests).toEqual(mockInterests);
  });

  it("includes geometryless city-wide events once their locality boundary matches a zone", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    const cityWide = createMapMessage("city-wide", [23.38, 42.65], {
      cityWide: true,
      geoJson: undefined,
    });
    const otherCity = { ...cityWide, id: "other-city", locality: "bg.other" };
    mockMessages = [cityWide, otherCity];

    const { rerender } = render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expectDisplayedMessages([]);

    mockLocalityBoundaries = {
      "bg.sofia": {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [23.3, 42.68],
                  [23.35, 42.68],
                  [23.35, 42.72],
                  [23.3, 42.72],
                  [23.3, 42.68],
                ],
              ],
            },
          },
        ],
      },
    };
    rerender(<HomeContent />);

    expectDisplayedMessages([cityWide]);
  });

  it("preserves archive, category, and source choices while switching views", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockSelectedCategories = new Set(["water"]);
    mockSelectedSources = new Set(["sofiyska-voda"]);
    const active = createMapMessage("active", [23.3219, 42.6977]);
    const archived = createMapMessage("archived", [23.322, 42.698], {
      createdAt: "2025-01-01T10:00:00.000Z",
    });
    const outside = createMapMessage("outside", [23.38, 42.65]);
    mockMessages = [active, archived, outside];

    const { rerender } = render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expectDisplayedMessages([active]);

    mockShowArchived = true;
    rerender(<HomeContent />);
    expectDisplayedMessages([active, archived]);

    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));
    expectDisplayedMessages(mockMessages);
    expect(capturedFilterBoxProps).toMatchObject({
      showArchived: true,
      selectedCategories: mockSelectedCategories,
      selectedSources: mockSelectedSources,
    });
    expect(mockSetSelectedCategories).not.toHaveBeenCalled();
    expect(mockSetSelectedSources).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expectDisplayedMessages([active, archived]);
  });

  it("keeps saved zones visible when no messages match", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockMessages = [createMapMessage("outside", [23.38, 42.65])];

    render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expectDisplayedMessages([]);
    expect(capturedMapContainerProps?.interests).toEqual(initialInterests);
    expect(capturedZoneListProps?.interests).toEqual(initialInterests);
    expect(screen.getByRole("button", { name: "Добави зона" })).toBeEnabled();
  });

  it("shows no events and keeps the add-zone action available without saved zones", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockInterests = [];
    mockMessages = [createMapMessage("outside", [23.38, 42.65])];

    render(<HomeContent />);
    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expectDisplayedMessages([]);
    expect(capturedMapContainerProps?.interests).toEqual([]);
    expect(capturedZoneListProps?.interests).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Добави зона" }));
    expect(selectedInterestState.handleStartAddInterest).toHaveBeenCalledOnce();
  });

  it.each(["narrow layout", "sign out"])(
    "handles an active zones view through %s",
    (transition) => {
      isWideDesktopLayout = true;
      authUser = { uid: "user-1" };
      const inside = createMapMessage("inside", [23.3219, 42.6977]);
      const outside = createMapMessage("outside", [23.38, 42.65]);
      mockMessages = [inside, outside];

      const { rerender } = render(<HomeContent />);
      fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
      expectDisplayedMessages([inside]);

      if (transition === "narrow layout") {
        isWideDesktopLayout = false;
      } else {
        authUser = null;
      }
      rerender(<HomeContent />);

      if (transition === "narrow layout") {
        expectDisplayedMessages([inside]);
        expect(screen.getByTestId("zone-list")).toBeVisible();
      } else {
        expectDisplayedMessages(mockMessages);
        expect(screen.queryByTestId("zone-list")).not.toBeInTheDocument();
      }
    },
  );

  it("automatically imports guest data when only guest has data and no decision is required", async () => {
    authUser = {
      uid: "account-uid",
      isAnonymous: false,
      getIdToken: vi.fn().mockResolvedValue("account-id-token"),
    };

    globalThis.sessionStorage.setItem(
      PENDING_GUEST_UPGRADE_UID_KEY,
      "guest-uid",
    );
    globalThis.sessionStorage.setItem(
      PENDING_GUEST_UPGRADE_TOKEN_KEY,
      "guest-proof-token",
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requiresDecision: false,
          hasGuestData: true,
          hasAccountData: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, changed: true, option: "import" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<HomeContent />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/upgrade",
      expect.objectContaining({
        method: "POST",
      }),
    );

    await waitFor(() => {
      expect(
        globalThis.sessionStorage.getItem(PENDING_GUEST_UPGRADE_UID_KEY),
      ).toBeNull();
      expect(
        globalThis.sessionStorage.getItem(PENDING_GUEST_UPGRADE_TOKEN_KEY),
      ).toBeNull();
    });
  });

  it("clears pending guest upgrade session when token is missing or invalid", async () => {
    authUser = {
      uid: "account-uid",
      isAnonymous: false,
      getIdToken: vi.fn().mockResolvedValue("account-id-token"),
    };

    globalThis.sessionStorage.setItem(
      PENDING_GUEST_UPGRADE_UID_KEY,
      "guest-uid",
    );
    globalThis.sessionStorage.setItem(PENDING_GUEST_UPGRADE_TOKEN_KEY, "");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<HomeContent />);

    await waitFor(() => {
      expect(
        globalThis.sessionStorage.getItem(PENDING_GUEST_UPGRADE_UID_KEY),
      ).toBeNull();
      expect(
        globalThis.sessionStorage.getItem(PENDING_GUEST_UPGRADE_TOKEN_KEY),
      ).toBeNull();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
