import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";

const { findByIdMock, updateOneMock } = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
  updateOneMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    notificationMatches: {
      findById: findByIdMock,
      updateOne: updateOneMock,
    },
  }),
}));

const { verifyAuthTokenMock } = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
}));

vi.mock("@/lib/verifyAuthToken", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

describe("POST /api/notifications/mark-read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAuthTokenMock.mockResolvedValue({ userId: "user-1" });
  });

  it("marks notification as read for authenticated user", async () => {
    findByIdMock.mockResolvedValue({
      _id: "notif-1",
      userId: "user-1",
      readAt: null,
      openedAt: null,
    });
    updateOneMock.mockResolvedValue(undefined);

    const request = new Request(
      "http://localhost/api/notifications/mark-read",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationId: "notif-1" }),
      },
    );

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(findByIdMock).toHaveBeenCalledWith("notif-1");
    expect(updateOneMock).toHaveBeenCalledWith("notif-1", {
      readAt: expect.any(String),
      openedAt: expect.any(String),
    });
  });

  it("sets readAt but does not overwrite existing openedAt (first-write-wins)", async () => {
    findByIdMock.mockResolvedValue({
      _id: "notif-1",
      userId: "user-1",
      readAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    });
    updateOneMock.mockResolvedValue(undefined);

    const request = new Request(
      "http://localhost/api/notifications/mark-read",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationId: "notif-1" }),
      },
    );

    const response = await POST(request as any);

    expect(response.status).toBe(200);
    expect(updateOneMock).toHaveBeenCalledWith("notif-1", {
      readAt: expect.any(String),
      // openedAt NOT included because it was already set
    });
    const callArg = updateOneMock.mock.calls[0][1];
    expect(callArg).not.toHaveProperty("openedAt");
  });

  it("returns 400 when notificationId is missing", async () => {
    const request = new Request(
      "http://localhost/api/notifications/mark-read",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("notificationId is required");
  });

  it("returns 404 when notification not found", async () => {
    findByIdMock.mockResolvedValue(null);

    const request = new Request(
      "http://localhost/api/notifications/mark-read",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationId: "notif-999" }),
      },
    );

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Notification not found");
  });

  it("returns 404 when notification belongs to different user", async () => {
    findByIdMock.mockResolvedValue({
      _id: "notif-1",
      userId: "user-2",
      readAt: null,
    });

    const request = new Request(
      "http://localhost/api/notifications/mark-read",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationId: "notif-1" }),
      },
    );

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Notification not found");
  });

  it("returns 500 when database fails", async () => {
    findByIdMock.mockRejectedValue(new Error("DB connection failed"));

    const request = new Request(
      "http://localhost/api/notifications/mark-read",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationId: "notif-1" }),
      },
    );

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to mark notification as read");
  });

  it("returns 401 when authentication fails", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("Missing auth token"));

    const request = new Request(
      "http://localhost/api/notifications/mark-read",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationId: "notif-1" }),
      },
    );

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain("Unauthorized");
  });
});
