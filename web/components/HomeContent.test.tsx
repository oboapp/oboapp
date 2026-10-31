import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import HomeContent from "@/components/HomeContent";
import {
  PENDING_GUEST_UPGRADE_UID_KEY,
  PENDING_GUEST_UPGRADE_TOKEN_KEY,
} from "@/lib/auth-upgrade";
import type { Interest, InternalMessage, Message } from "@/lib/types";
import type { LocalityBoundaries } from "@/lib/zone-event-filter";

let isWideDesktopLayout = false;
let capturedMapContainerProps: Record<string, unknown> | null = null;
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
const mockSetSelectedCategories = vi.fn();
const mockSetSelectedSources = vi.fn();
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
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("@/components/GeolocationPrompt", () => ({
  default: () => <div data-testid="geolocation-prompt" />,
}));

vi.mock("@/components/onboarding/OnboardingPrompt", () => ({
  default: () => <div data-testid="onboarding-prompt" />,
}));

vi.mock("@/components/onboarding/AddZoneModal", () => ({
  default: () => <div data-testid="add-zone-modal" />,
}));

vi.mock("@/components/SegmentedControl", () => ({
  default: (props: {
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    onChange: (value: string) => void;
  }) => (
    <div data-testid="segmented-control">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={Boolean(option.disabled)}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ZoneBadges", () => ({
  default: () => <div data-testid="zone-badges" />,
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
    hasInitialized: true,
    addInterest: vi.fn(),
    updateInterest: vi.fn(),
    deleteInterest: vi.fn(),
  }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: authUser }),
}));

vi.mock("@/lib/hooks/useMessages", () => ({
  useMessages: () => ({
    messages: mockMessages,
    availableCategories: [],
    isLoading: false,
    error: null,
    handleBoundsChanged: mockHandleBoundsChanged,
    suppressNextViewportFetch: vi.fn(),
    setSelectedCategories: mockSetSelectedCategories,
    setSelectedSources: mockSetSelectedSources,
  }),
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
    mapInstance: null,
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
  getFeaturesBounds: () => null,
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
    authUser = null;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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

  it("wires move/delete callbacks into ZoneList on authenticated desktop zones view", async () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };

    render(<HomeContent />);
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));

    expectDisplayedMessages([inside, crossing]);
    expect(capturedCategoryMessages).toEqual([inside, crossing]);
    expect(capturedSourceMessages).toEqual([inside, crossing]);
    expect(capturedMapContainerProps?.interests).toEqual(mockInterests);

    fireEvent.click(screen.getByRole("button", { name: "Събития" }));

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
      fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));

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

      fireEvent.click(screen.getByRole("button", { name: "Събития" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));

    expectDisplayedMessages([inside]);
    expect(capturedMapContainerProps?.interests).toHaveLength(2);
  });

  it("keeps zone filtering active when panning supplies refreshed messages", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    const initialInside = createMapMessage("initial-inside", [23.3219, 42.6977]);
    const refreshedInside = createMapMessage("refreshed-inside", [23.322, 42.698]);
    const refreshedOutside = createMapMessage("refreshed-outside", [23.38, 42.65]);
    mockMessages = [initialInside];

    const { rerender } = render(<HomeContent />);
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));
    expectDisplayedMessages([initialInside]);

    const bounds = {
      north: 42.8,
      south: 42.6,
      east: 23.5,
      west: 23.2,
      zoom: 12,
    };
    expect(capturedMapContainerProps?.onBoundsChanged).toBe(
      mockHandleBoundsChanged,
    );
    mockHandleBoundsChanged.mockImplementationOnce(() => {
      mockMessages = [refreshedOutside, refreshedInside];
    });
    mockHandleBoundsChanged(bounds);
    rerender(<HomeContent />);

    expectDisplayedMessages([refreshedInside]);
    expect(capturedMapContainerProps?.interests).toEqual(initialInterests);
  });

  it("recomputes matches when saved zones move", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    const homeEvent = createMapMessage("home", [23.3219, 42.6977]);
    const workEvent = createMapMessage("work", [23.38, 42.65]);
    mockMessages = [homeEvent, workEvent];

    const { rerender } = render(<HomeContent />);
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));
    expectDisplayedMessages([active]);

    mockShowArchived = true;
    rerender(<HomeContent />);
    expectDisplayedMessages([active, archived]);

    fireEvent.click(screen.getByRole("button", { name: "Събития" }));
    expectDisplayedMessages(mockMessages);
    expect(capturedFilterBoxProps).toMatchObject({
      showArchived: true,
      selectedCategories: mockSelectedCategories,
      selectedSources: mockSelectedSources,
    });
    expect(mockSetSelectedCategories).not.toHaveBeenCalled();
    expect(mockSetSelectedSources).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));
    expectDisplayedMessages([active, archived]);
  });

  it("keeps saved zones visible when no messages match", () => {
    isWideDesktopLayout = true;
    authUser = { uid: "user-1" };
    mockMessages = [createMapMessage("outside", [23.38, 42.65])];

    render(<HomeContent />);
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));

    expectDisplayedMessages([]);
    expect(capturedMapContainerProps?.interests).toEqual([]);
    expect(capturedZoneListProps?.interests).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Добави зона" }));
    expect(selectedInterestState.handleStartAddInterest).toHaveBeenCalledOnce();
  });

  it.each(["narrow layout", "sign out"])(
    "restores Events when leaving My zones through %s",
    (transition) => {
      isWideDesktopLayout = true;
      authUser = { uid: "user-1" };
      const inside = createMapMessage("inside", [23.3219, 42.6977]);
      const outside = createMapMessage("outside", [23.38, 42.65]);
      mockMessages = [inside, outside];

      const { rerender } = render(<HomeContent />);
      fireEvent.click(screen.getByRole("button", { name: "Моите зони" }));
      expectDisplayedMessages([inside]);

      if (transition === "narrow layout") {
        isWideDesktopLayout = false;
      } else {
        authUser = null;
      }
      rerender(<HomeContent />);

      expectDisplayedMessages(mockMessages);
      expect(screen.queryByTestId("zone-list")).not.toBeInTheDocument();
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
