import { http, HttpResponse } from "msw";
import { MOCK_MESSAGES } from "./fixtures/messages";
import { MOCK_UNREADABLE_MESSAGES } from "./fixtures/unreadable-messages";
import { MOCK_INTERESTS, MOCK_USER_ID } from "./fixtures/interests";
import { MOCK_SUBSCRIPTIONS } from "./fixtures/subscriptions";
import { MOCK_NOTIFICATION_HISTORY } from "./fixtures/notification-history";
import { MOCK_API_CLIENT } from "./fixtures/api-client";
import { MOCK_EVENTS, MOCK_EVENT_MESSAGES } from "./fixtures/events";
import { getCentroid } from "@/lib/geometry-utils";
import type {
  Interest,
  NotificationSubscription,
  ApiClient,
} from "@/lib/types";
import type { Message } from "@oboapp/shared";

/**
 * MSW request handlers for API routes
 * Provides static mock responses for front-end development without Firebase emulators
 */

// In-memory state for CRUD operations
let interests: Interest[] = [...MOCK_INTERESTS];
let subscriptions: NotificationSubscription[] = [...MOCK_SUBSCRIPTIONS];
let apiClient: ApiClient | null = null; // Start with no API client
let notificationHistory = [...MOCK_NOTIFICATION_HISTORY];
let notificationFilters = {
  notificationCategories: [] as string[],
  notificationSources: [] as string[],
  experimentalFeatures: false,
};

/**
 * Helper: Filter messages by viewport bounds
 */
function filterMessagesByViewport(
  messages: Message[],
  north?: number,
  south?: number,
  east?: number,
  west?: number,
): Message[] {
  if (
    north === undefined ||
    south === undefined ||
    east === undefined ||
    west === undefined
  ) {
    return messages;
  }

  return messages.filter((msg) => {
    // City-wide messages always visible
    if (msg.cityWide) return true;

    // Messages without GeoJSON not visible
    if (!msg.geoJson || msg.geoJson.features.length === 0) return false;

    // Check if any feature intersects viewport
    return msg.geoJson.features.some((feature) => {
      if (feature.geometry.type === "Point") {
        const [lng, lat] = feature.geometry.coordinates;
        return lat >= south && lat <= north && lng >= west && lng <= east;
      }

      if (feature.geometry.type === "LineString") {
        return feature.geometry.coordinates.some(([lng, lat]) => {
          return lat >= south && lat <= north && lng >= west && lng <= east;
        });
      }

      if (feature.geometry.type === "Polygon") {
        return feature.geometry.coordinates[0].some(([lng, lat]) => {
          return lat >= south && lat <= north && lng >= west && lng <= east;
        });
      }

      return false;
    });
  });
}

/**
 * Helper: Filter messages by categories
 */
function filterMessagesByCategories(
  messages: Message[],
  categories?: string[],
): Message[] {
  if (!categories || categories.length === 0) {
    return messages;
  }

  const includeUncategorized = categories.includes("uncategorized");
  const realCategories = categories.filter((c) => c !== "uncategorized");

  return messages.filter((msg) => {
    const hasNoCategories = !msg.categories || msg.categories.length === 0;

    if (includeUncategorized && hasNoCategories) return true;

    if (realCategories.length === 0) return false;

    return msg.categories?.some((cat) => realCategories.includes(cat));
  });
}

/**
 * Helper: Filter messages by sources
 */
function filterMessagesBySources(
  messages: Message[],
  sources?: string[],
): Message[] {
  if (!sources || sources.length === 0) {
    return messages;
  }

  return messages.filter((msg) => {
    return msg.source && sources.includes(msg.source);
  });
}

export const handlers = [
  // GET /api/messages/heatmap - Return heatmap coordinate points from all finalized messages
  http.get("/api/messages/heatmap", ({ request }) => {
    const url = new URL(request.url);
    const categoriesParam = url.searchParams.get("categories");
    const sourcesParam = url.searchParams.get("sources");

    const selectedCategories = categoriesParam
      ? categoriesParam.split(",").map((v) => v.trim()).filter(Boolean)
      : undefined;
    const selectedSources = sourcesParam
      ? sourcesParam.split(",").map((v) => v.trim()).filter(Boolean)
      : undefined;

    // Mirror production behaviour: skip city-wide messages, then compute one
    // centroid per feature (or one point per coordinate for MultiPoint).
    let heatmapMessages = MOCK_MESSAGES.filter(
      (msg) => !msg.cityWide && msg.geoJson?.features,
    );

    // Apply category filter
    heatmapMessages = filterMessagesByCategories(
      heatmapMessages,
      selectedCategories,
    );

    // Apply source filter
    heatmapMessages = filterMessagesBySources(heatmapMessages, selectedSources);

    const points: [number, number][] = heatmapMessages.flatMap((msg) =>
      msg.geoJson!.features.flatMap((f) => {
        if (!f.geometry) return [] as [number, number][];
        // MultiPoint: each coordinate is a distinct pin
        if (f.geometry.type === "MultiPoint") {
          return (f.geometry.coordinates as [number, number][]).map(
            ([lng, lat]) => [lat, lng] as [number, number],
          );
        }
        // Point, LineString, Polygon → single centroid
        const centroid = getCentroid(f.geometry);
        return centroid
          ? ([[centroid.lat, centroid.lng]] as [number, number][])
          : ([] as [number, number][]);
      }),
    );

    const messageCount = heatmapMessages.length;

    const oldestDate =
      heatmapMessages.length === 0
        ? null
        : heatmapMessages.reduce<string | null>((oldest, msg) => {
            const fa = (msg as Record<string, unknown>).finalizedAt as
              | string
              | undefined;
            if (!fa) return oldest;
            if (!oldest) return fa;
            return fa < oldest ? fa : oldest;
          }, null);

    return HttpResponse.json({ points, messageCount, oldestDate });
  }),

  // GET /api/messages - Fetch messages with viewport/category/source filtering
  http.get("/api/messages", ({ request }) => {
    const url = new URL(request.url);
    const north = url.searchParams.get("north");
    const south = url.searchParams.get("south");
    const east = url.searchParams.get("east");
    const west = url.searchParams.get("west");
    const categoriesParam = url.searchParams.get("categories");
    const sourcesParam = url.searchParams.get("sources");

    const categories = categoriesParam
      ? categoriesParam.split(",").filter(Boolean)
      : undefined;

    const sources = sourcesParam
      ? sourcesParam.split(",").filter(Boolean)
      : undefined;

    let filteredMessages = [...MOCK_MESSAGES];

    // Apply viewport filtering
    filteredMessages = filterMessagesByViewport(
      filteredMessages,
      north ? Number.parseFloat(north) : undefined,
      south ? Number.parseFloat(south) : undefined,
      east ? Number.parseFloat(east) : undefined,
      west ? Number.parseFloat(west) : undefined,
    );

    // Apply category filtering
    filteredMessages = filterMessagesByCategories(filteredMessages, categories);

    // Apply source filtering
    filteredMessages = filterMessagesBySources(filteredMessages, sources);

    return HttpResponse.json({ messages: filteredMessages });
  }),

  // GET /api/messages/[id] - Fetch single message by ID
  http.get("/api/messages/:id", ({ params }) => {
    const { id } = params;
    const message = MOCK_MESSAGES.find((m) => m.id === id);

    if (!message) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json(message);
  }),

  // GET /api/messages/by-id?id=... - Fetch single message by ID (query param)
  http.get("/api/messages/by-id", ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new HttpResponse(null, { status: 404 });
    }

    const message = MOCK_MESSAGES.find((m) => m.id === id);

    if (!message) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json({ message });
  }),

  // GET /api/interests - Fetch all interests for authenticated user
  http.get("/api/interests", () => {
    return HttpResponse.json({ interests });
  }),

  // POST /api/interests - Create new interest
  http.post("/api/interests", async ({ request }) => {
    const body = (await request.json()) as {
      coordinates: { lat: number; lng: number };
      radius: number;
      label?: string;
      color?: string;
    };

    const newInterest: Interest = {
      id: `interest-${Date.now()}`,
      userId: MOCK_USER_ID,
      coordinates: body.coordinates,
      radius: Math.max(100, Math.min(1000, body.radius || 500)),
      ...(body.label ? { label: body.label } : {}),
      ...(body.color ? { color: body.color } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    interests.push(newInterest);
    return HttpResponse.json({ interest: newInterest }, { status: 201 });
  }),

  // PATCH /api/interests - Update interest (body contains id)
  http.patch("/api/interests", async ({ request }) => {
    const body = (await request.json()) as {
      id: string;
      coordinates?: { lat: number; lng: number };
      radius?: number;
      label?: string;
      color?: string;
    };
    const { id } = body;

    const index = interests.findIndex((i) => i.id === id);
    if (index === -1) {
      return new HttpResponse(null, { status: 404 });
    }

    const updated: Interest = {
      ...interests[index],
      coordinates: body.coordinates ?? interests[index].coordinates,
      radius: body.radius
        ? Math.max(100, Math.min(1000, body.radius))
        : interests[index].radius,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      updatedAt: new Date().toISOString(),
    };

    interests[index] = updated;
    return HttpResponse.json({ interest: updated });
  }),

  // DELETE /api/interests?id=... - Delete interest
  http.delete("/api/interests", ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const index = interests.findIndex((i) => i.id === id);

    if (index === -1) {
      return new HttpResponse(null, { status: 404 });
    }

    interests.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // GET /api/notifications/subscription - Check if user has subscription
  http.get("/api/notifications/subscription", () => {
    return HttpResponse.json({ hasSubscription: subscriptions.length > 0 });
  }),

  // POST /api/notifications/subscription - Create or update subscription
  http.post("/api/notifications/subscription", async ({ request }) => {
    const body = (await request.json()) as {
      token: string;
      endpoint: string;
      deviceInfo?: { userAgent?: string; platform?: string };
    };

    // Check if subscription exists
    const existing = subscriptions.find((s) => s.token === body.token);

    if (existing) {
      // Update existing
      existing.endpoint = body.endpoint;
      existing.deviceInfo = body.deviceInfo;
      existing.updatedAt = new Date().toISOString();
      return HttpResponse.json(existing);
    }

    // Create new subscription
    const newSubscription: NotificationSubscription = {
      id: `sub-${Date.now()}`,
      userId: MOCK_USER_ID,
      token: body.token,
      endpoint: body.endpoint,
      deviceInfo: body.deviceInfo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    subscriptions.push(newSubscription);
    return HttpResponse.json(newSubscription, { status: 201 });
  }),

  // DELETE /api/notifications/subscription - Delete subscription by token
  http.delete("/api/notifications/subscription", async ({ request }) => {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return HttpResponse.json(
        { error: "Token parameter required" },
        { status: 400 },
      );
    }

    const index = subscriptions.findIndex((s) => s.token === token);
    if (index === -1) {
      return new HttpResponse(null, { status: 404 });
    }

    subscriptions.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // GET /api/notifications/subscription/all - Fetch all subscriptions
  http.get("/api/notifications/subscription/all", () => {
    return HttpResponse.json(subscriptions);
  }),

  // DELETE /api/notifications/subscription/all - Delete all subscriptions
  http.delete("/api/notifications/subscription/all", () => {
    const deleted = subscriptions.length;
    subscriptions.length = 0; // Clear array
    return HttpResponse.json({ success: true, deleted });
  }),

  // GET /api/notifications/filters - Get notification filter preferences
  http.get("/api/notifications/filters", () => {
    return HttpResponse.json(notificationFilters);
  }),

  // PUT /api/notifications/filters - Save notification filter preferences
  http.put("/api/notifications/filters", async ({ request }) => {
    const body = (await request.json()) as {
      notificationCategories?: string[];
      notificationSources?: string[];
      experimentalFeatures?: boolean;
    };
    notificationFilters = {
      notificationCategories: body.notificationCategories ?? [],
      notificationSources: body.notificationSources ?? [],
      experimentalFeatures: body.experimentalFeatures ?? false,
    };
    return HttpResponse.json(notificationFilters);
  }),

  // DELETE /api/notifications/filters - Clear notification filter preferences
  http.delete("/api/notifications/filters", () => {
    notificationFilters = {
      notificationCategories: [],
      notificationSources: [],
      experimentalFeatures: false,
    };
    return HttpResponse.json(notificationFilters);
  }),

  // GET /api/notifications/history - Fetch notification history with pagination
  http.get("/api/notifications/history", ({ request }) => {
    const url = new URL(request.url);

    const rawLimit = url.searchParams.get("limit");
    let limit = Number.parseInt(rawLimit ?? "", 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      // Default page size when missing/invalid
      limit = 20;
    } else {
      // Enforce maximum page size
      limit = Math.min(limit, 100);
    }

    const rawOffset = url.searchParams.get("offset");
    let offset = Number.parseInt(rawOffset ?? "", 10);
    if (!Number.isFinite(offset) || offset < 0) {
      // Clamp negative/invalid offsets to 0
      offset = 0;
    }

    const items = notificationHistory.slice(offset, offset + limit);
    const hasMore = offset + limit < notificationHistory.length;
    const nextOffset = hasMore ? offset + limit : null;

    return HttpResponse.json({ items, hasMore, nextOffset });
  }),

  // GET /api/notifications/history/count - Get notification count
  http.get("/api/notifications/history/count", () => {
    return HttpResponse.json({ count: notificationHistory.length });
  }),

  // GET /api/notifications/unread-count - Get unread notification count
  http.get("/api/notifications/unread-count", () => {
    const unreadCount = notificationHistory.filter((n) => !n.readAt).length;
    return HttpResponse.json({ count: unreadCount });
  }),

  // POST /api/notifications/mark-read - Mark a notification as read
  http.post("/api/notifications/mark-read", async ({ request }) => {
    const body = (await request.json()) as { notificationId: string };
    const notification = notificationHistory.find(
      (n) => n.id === body.notificationId,
    );

    if (!notification) {
      return HttpResponse.json(
        { error: "Notification not found" },
        { status: 404 },
      );
    }

    notification.readAt = new Date().toISOString();
    return HttpResponse.json({ success: true });
  }),

  // POST /api/notifications/mark-all-read - Mark all notifications as read
  http.post("/api/notifications/mark-all-read", () => {
    const readAt = new Date().toISOString();
    const unreadCount = notificationHistory.filter((n) => !n.readAt).length;

    notificationHistory.forEach((notification) => {
      if (!notification.readAt) {
        notification.readAt = readAt;
      }
    });

    return HttpResponse.json({ success: true, count: unreadCount });
  }),

  // DELETE /api/user - Delete user account (mock - just clear data)
  http.delete("/api/user", () => {
    // Reset to empty state
    interests = [];
    subscriptions = [];
    apiClient = null;
    notificationHistory = [];
    notificationFilters = {
      notificationCategories: [],
      notificationSources: [],
      experimentalFeatures: false,
    };
    return new HttpResponse(null, { status: 204 });
  }),

  // GET /api/api-clients - Get current user's API client
  http.get("/api/api-clients", () => {
    return HttpResponse.json(apiClient);
  }),

  // POST /api/api-clients - Generate a new API key
  http.post("/api/api-clients", async ({ request }) => {
    if (apiClient) {
      return HttpResponse.json(
        {
          error:
            "You already have an API key. Revoke it first to generate a new one.",
        },
        { status: 409 },
      );
    }
    const body = (await request.json()) as { websiteUrl: string };
    const now = new Date().toISOString();
    apiClient = {
      ...MOCK_API_CLIENT,
      id: `api-client-${Date.now()}`,
      userId: MOCK_USER_ID,
      apiKey: `obo_mock${Math.random().toString(36).slice(2)}`,
      websiteUrl: body.websiteUrl,
      createdAt: now,
      updatedAt: now,
    };
    return HttpResponse.json(apiClient, { status: 201 });
  }),

  // DELETE /api/api-clients - Revoke current user's API key
  http.delete("/api/api-clients", () => {
    if (!apiClient) {
      return HttpResponse.json(
        { error: "No API client found" },
        { status: 404 },
      );
    }
    apiClient = null;
    return HttpResponse.json({ success: true });
  }),

  // GET /api/messages/unreadable - Return messages flagged as unreadable (PDF/DOCX only)
  http.get("/api/messages/unreadable", () => {
    return HttpResponse.json({
      messages: MOCK_UNREADABLE_MESSAGES,
      nextCursor: undefined,
    });
  }),

  // GET /api/events - Return paginated events sorted by updatedAt desc
  http.get("/api/events", ({ request }) => {
    const url = new URL(request.url);
    const cursorUpdatedAt = url.searchParams.get("cursorUpdatedAt");
    const cursorId = url.searchParams.get("cursorId");

    let events = [...MOCK_EVENTS].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    if (cursorUpdatedAt && cursorId) {
      const cursorTime = new Date(cursorUpdatedAt).getTime();
      events = events.filter((evt) => {
        const evtTime = new Date(evt.updatedAt).getTime();
        if (evtTime < cursorTime) return true;
        if (evtTime > cursorTime) return false;
        return (evt.id ?? "").localeCompare(cursorId) < 0;
      });
    }

    return HttpResponse.json({
      events,
      nextCursor: undefined,
    });
  }),

  // GET /api/events/messages - Return messages linked to a specific event
  http.get("/api/events/messages", ({ request }) => {
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId");

    if (!eventId) {
      return HttpResponse.json(
        { error: "eventId query parameter is required" },
        { status: 400 },
      );
    }

    const eventMessages = MOCK_EVENT_MESSAGES.filter(
      (em) => em.eventId === eventId,
    );
    const messageIds = new Set(eventMessages.map((em) => em.messageId));
    const messages = MOCK_MESSAGES.filter((m) => messageIds.has(m.id ?? ""));

    return HttpResponse.json({ messages, eventMessages });
  }),
];
