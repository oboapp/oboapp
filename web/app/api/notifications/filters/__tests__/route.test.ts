import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT, DELETE } from "../route";

const { findByUserIdMock, upsertByUserIdMock, updateOneMock } = vi.hoisted(
  () => ({
    findByUserIdMock: vi.fn(),
    upsertByUserIdMock: vi.fn(),
    updateOneMock: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    userPreferences: {
      findByUserId: findByUserIdMock,
      upsertByUserId: upsertByUserIdMock,
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

describe("GET /api/notifications/filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAuthTokenMock.mockResolvedValue({ userId: "user-1" });
  });

  it("returns empty filters when no preferences document exists", async () => {
    findByUserIdMock.mockResolvedValue(null);

    const request = new Request(
      "http://localhost/api/notifications/filters",
      { headers: { authorization: "Bearer test-token" } },
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      notificationCategories: [],
      notificationSources: [],
      experimentalFeatures: false,
    });
  });

  it("returns saved filter preferences", async () => {
    findByUserIdMock.mockResolvedValue({
      _id: "prefs-1",
      userId: "user-1",
      notificationCategories: ["water", "electricity"],
      notificationSources: ["sofiyska-voda"],
    });

    const request = new Request(
      "http://localhost/api/notifications/filters",
      { headers: { authorization: "Bearer test-token" } },
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      notificationCategories: ["water", "electricity"],
      notificationSources: ["sofiyska-voda"],
      experimentalFeatures: false,
    });
  });

  it("returns 401 when auth token is missing", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("Missing auth token"));

    const request = new Request("http://localhost/api/notifications/filters");

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when auth token is invalid", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("Invalid auth token"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      { headers: { authorization: "Bearer bad-token" } },
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 500 when database fails", async () => {
    findByUserIdMock.mockRejectedValue(new Error("DB connection failed"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      { headers: { authorization: "Bearer test-token" } },
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch notification filters");
  });
});

describe("PUT /api/notifications/filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAuthTokenMock.mockResolvedValue({ userId: "user-1" });
  });

  it("saves valid filter preferences", async () => {
    upsertByUserIdMock.mockResolvedValue(undefined);

    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          notificationCategories: ["water"],
          notificationSources: ["sofiyska-voda"],
        }),
      },
    );

    const response = await PUT(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      notificationCategories: ["water"],
      notificationSources: ["sofiyska-voda"],
      experimentalFeatures: false,
    });
    expect(upsertByUserIdMock).toHaveBeenCalledWith("user-1", {
      notificationCategories: ["water"],
      notificationSources: ["sofiyska-voda"],
      experimentalFeatures: false,
    });
  });

  it("saves empty filter arrays (reset all filters)", async () => {
    upsertByUserIdMock.mockResolvedValue(undefined);

    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          notificationCategories: [],
          notificationSources: [],
        }),
      },
    );

    const response = await PUT(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ notificationCategories: [], notificationSources: [], experimentalFeatures: false });
  });

  it("returns 400 for invalid category value", async () => {
    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          notificationCategories: ["not-a-valid-category"],
          notificationSources: [],
        }),
      },
    );

    const response = await PUT(request as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid request body");
  });

  it("returns 401 when auth token is missing", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("Missing auth token"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationCategories: [], notificationSources: [] }),
      },
    );

    const response = await PUT(request as any);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when auth token is invalid", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("Invalid auth token"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer bad-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationCategories: [], notificationSources: [] }),
      },
    );

    const response = await PUT(request as any);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 500 when database fails", async () => {
    upsertByUserIdMock.mockRejectedValue(new Error("DB connection failed"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationCategories: [], notificationSources: [] }),
      },
    );

    const response = await PUT(request as any);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to save notification filters");
  });
});

describe("DELETE /api/notifications/filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAuthTokenMock.mockResolvedValue({ userId: "user-1" });
    upsertByUserIdMock.mockResolvedValue("user-1");
  });

  it("clears filters for a user", async () => {
    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "DELETE",
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await DELETE(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ notificationCategories: [], notificationSources: [], experimentalFeatures: false });
    expect(upsertByUserIdMock).toHaveBeenCalledWith("user-1", {
      notificationCategories: [],
      notificationSources: [],
      experimentalFeatures: false,
    });
  });

  it("returns 401 when auth token is missing", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("Missing auth token"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      { method: "DELETE" },
    );

    const response = await DELETE(request as any);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when auth token is invalid", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("Invalid auth token"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "DELETE",
        headers: { authorization: "Bearer bad-token" },
      },
    );

    const response = await DELETE(request as any);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 500 when database fails", async () => {
    upsertByUserIdMock.mockRejectedValue(new Error("DB connection failed"));

    const request = new Request(
      "http://localhost/api/notifications/filters",
      {
        method: "DELETE",
        headers: { authorization: "Bearer test-token" },
      },
    );

    const response = await DELETE(request as any);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to clear notification filters");
  });
});
