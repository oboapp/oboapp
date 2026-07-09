import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  removeSubscriptionFromBackend,
  subscribeToPushNotifications,
} from "./notification-service";

// Mock Firebase modules before importing the notification service
vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase/messaging", () => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  onMessage: vi.fn(),
  isSupported: vi.fn(() => Promise.resolve(true)),
  deleteToken: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
}));

vi.mock("./firebase", () => ({
  app: {},
  db: {},
  auth: {},
}));

// Mock global fetch
global.fetch = vi.fn();

describe("removeSubscriptionFromBackend", () => {
  const mockToken = "test-fcm-token-12345";
  const mockIdToken = "test-id-token-67890";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should successfully remove subscription when API returns 200", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse
    );

    const result = await removeSubscriptionFromBackend(mockToken, mockIdToken);

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/notifications/subscription?token=${encodeURIComponent(mockToken)}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mockIdToken}`,
        },
      }
    );
  });

  it("should return false when API returns non-ok status", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      json: async () => ({ error: "Subscription not found" }),
    } as Response;

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse
    );

    const result = await removeSubscriptionFromBackend(mockToken, mockIdToken);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to remove subscription from backend"
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("should return false when API returns 500 error", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal server error" }),
    } as Response;

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse
    );

    const result = await removeSubscriptionFromBackend(mockToken, mockIdToken);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to remove subscription from backend"
    );

    consoleErrorSpy.mockRestore();
  });

  it("should return false and log error when fetch throws network error", async () => {
    const networkError = new Error("Network error");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      networkError
    );

    const result = await removeSubscriptionFromBackend(mockToken, mockIdToken);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error removing subscription from backend:",
      networkError
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("should properly encode token with special characters", async () => {
    const specialToken = "token/with+special=chars&more";
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse
    );

    const result = await removeSubscriptionFromBackend(
      specialToken,
      mockIdToken
    );

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/notifications/subscription?token=${encodeURIComponent(specialToken)}`,
      expect.any(Object)
    );
  });

  it("should include Authorization header with Bearer token", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse
    );

    await removeSubscriptionFromBackend(mockToken, mockIdToken);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockIdToken}`,
        }),
      })
    );
  });

  it("should handle empty token string", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse
    );

    const result = await removeSubscriptionFromBackend("", mockIdToken);

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/notifications/subscription?token=",
      expect.any(Object)
    );
  });

  it("should return false when fetch throws TypeError (e.g., network failure)", async () => {
    const typeError = new TypeError("Failed to fetch");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(typeError);

    const result = await removeSubscriptionFromBackend(mockToken, mockIdToken);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error removing subscription from backend:",
      typeError
    );

    consoleErrorSpy.mockRestore();
  });
});

describe("subscribeToPushNotifications", () => {
  const requiredEnvVars = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "NEXT_PUBLIC_FIREBASE_VAPID_KEY",
  ] as const;

  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.clearAllMocks();
    for (const envVar of requiredEnvVars) {
      originalEnv.set(envVar, process.env[envVar]);
      process.env[envVar] = "configured";
    }
  });

  afterEach(() => {
    for (const envVar of requiredEnvVars) {
      const value = originalEnv.get(envVar);
      if (value === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = value;
      }
    }
    originalEnv.clear();
    vi.restoreAllMocks();
  });

  it("returns null and warns when required messaging config is missing", async () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const result = await subscribeToPushNotifications("user-1", "token-1");

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[Notifications] Messaging config missing (NEXT_PUBLIC_FIREBASE_VAPID_KEY). Notification subscription is disabled.",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
