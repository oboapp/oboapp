import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

const { findByUserIdMock } = vi.hoisted(() => ({
  findByUserIdMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    notificationMatches: {
      findByUserId: findByUserIdMock,
    },
  }),
}));

vi.mock("@/lib/verifyAuthToken", () => ({
  verifyAuthToken: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

describe("GET /api/notifications/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 when notifiedAt is invalid instead of fabricating current time", async () => {
    findByUserIdMock.mockResolvedValue([
      {
        _id: "match-1",
        messageId: "msg-1",
        notifiedAt: 123,
        distance: 50,
        interestId: "interest-1",
        deviceNotifications: [],
      },
    ]);

    const request = new Request("http://localhost/api/notifications/history", {
      headers: { authorization: "Bearer test-token" },
    });

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch notification history");
  });

  it("returns paginated results with default limit of 20", async () => {
    const mockNotifications = Array.from({ length: 15 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request("http://localhost/api/notifications/history", {
      headers: { authorization: "Bearer test-token" },
    });

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(15);
    expect(data.hasMore).toBe(false);
    expect(data.nextOffset).toBe(null);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 21, // default 20 + 1 to check for more
      offset: 0,
    });
  });

  it("includes source fields from messageSnapshot when present", async () => {
    findByUserIdMock.mockResolvedValue([
      {
        _id: "match-1",
        messageId: "msg-1",
        notifiedAt: new Date().toISOString(),
        distance: 50,
        interestId: "interest-1",
        deviceNotifications: [],
        messageSnapshot: {
          text: "Message with source",
          createdAt: new Date().toISOString(),
          source: "sofia-bg",
          sourceUrl: "https://www.sofia.bg",
        },
      },
    ]);

    const request = new Request("http://localhost/api/notifications/history", {
      headers: { authorization: "Bearer test-token" },
    });

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].messageSnapshot.source).toBe("sofia-bg");
    expect(data.items[0].messageSnapshot.sourceUrl).toBe(
      "https://www.sofia.bg",
    );
  });

  it("indicates hasMore when there are more results", async () => {
    // Return 21 items when limit is 20 (20 + 1 to check for more)
    const mockNotifications = Array.from({ length: 21 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request("http://localhost/api/notifications/history", {
      headers: { authorization: "Bearer test-token" },
    });

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(20); // Should return only 20
    expect(data.hasMore).toBe(true);
    expect(data.nextOffset).toBe(20);
  });

  it("respects custom limit parameter", async () => {
    const mockNotifications = Array.from({ length: 11 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request(
      "http://localhost/api/notifications/history?limit=10",
      {
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(10);
    expect(data.hasMore).toBe(true);
    expect(data.nextOffset).toBe(10);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 11, // requested limit + 1
      offset: 0,
    });
  });

  it("respects offset parameter for pagination", async () => {
    const mockNotifications = Array.from({ length: 10 }, (_, i) => ({
      _id: `match-${i + 20}`,
      messageId: `msg-${i + 20}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i + 20}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request(
      "http://localhost/api/notifications/history?offset=20",
      {
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(10);
    expect(data.hasMore).toBe(false);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 21,
      offset: 20,
    });
  });

  it("enforces maximum limit of 100", async () => {
    const mockNotifications = Array.from({ length: 101 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request(
      "http://localhost/api/notifications/history?limit=200",
      {
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(100); // Should be capped at 100
    expect(data.hasMore).toBe(true);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 101, // max limit + 1
      offset: 0,
    });
  });

  it("handles invalid limit parameter (NaN)", async () => {
    const mockNotifications = Array.from({ length: 5 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request(
      "http://localhost/api/notifications/history?limit=invalid",
      {
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await GET(request as any);
    await response.json();

    expect(response.status).toBe(200);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 21, // Should fall back to default 20 + 1
      offset: 0,
    });
  });

  it("handles negative limit parameter", async () => {
    const mockNotifications = Array.from({ length: 5 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request(
      "http://localhost/api/notifications/history?limit=-10",
      {
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await GET(request as any);
    await response.json();

    expect(response.status).toBe(200);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 21, // Should fall back to default 20 + 1
      offset: 0,
    });
  });

  it("handles invalid offset parameter (NaN)", async () => {
    const mockNotifications = Array.from({ length: 5 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request(
      "http://localhost/api/notifications/history?offset=invalid",
      {
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await GET(request as any);
    await response.json();

    expect(response.status).toBe(200);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 21,
      offset: 0, // Should fall back to 0
    });
  });

  it("handles negative offset parameter", async () => {
    const mockNotifications = Array.from({ length: 5 }, (_, i) => ({
      _id: `match-${i}`,
      messageId: `msg-${i}`,
      notifiedAt: new Date().toISOString(),
      distance: 50,
      interestId: "interest-1",
      deviceNotifications: [],
      messageSnapshot: {
        text: `Message ${i}`,
        createdAt: new Date().toISOString(),
      },
    }));

    findByUserIdMock.mockResolvedValue(mockNotifications);

    const request = new Request(
      "http://localhost/api/notifications/history?offset=-5",
      {
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await GET(request as any);
    await response.json();

    expect(response.status).toBe(200);
    expect(findByUserIdMock).toHaveBeenCalledWith("user-1", {
      limit: 21,
      offset: 0, // Should fall back to 0
    });
  });

  it("handles empty results", async () => {
    findByUserIdMock.mockResolvedValue([]);

    const request = new Request("http://localhost/api/notifications/history", {
      headers: { authorization: "Bearer test-token" },
    });

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(0);
    expect(data.hasMore).toBe(false);
    expect(data.nextOffset).toBe(null);
  });
});
