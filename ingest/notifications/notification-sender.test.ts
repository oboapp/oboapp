import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildNotificationPayload,
  sendPushNotification,
  sendToUserDevices,
} from "./notification-sender";
import type {
  Message,
  NotificationMatch,
  NotificationSubscription,
} from "@/lib/types";

// Mock subscription-manager
vi.mock("./subscription-manager", () => ({
  getUserSubscriptions: vi.fn(),
  deleteSubscription: vi.fn(),
}));

import {
  getUserSubscriptions,
  deleteSubscription,
} from "./subscription-manager";

const mockGetUserSubscriptions = vi.mocked(getUserSubscriptions);
const mockDeleteSubscription = vi.mocked(deleteSubscription);

function createMockMessaging(sendBehavior?: () => Promise<string>) {
  return {
    send: sendBehavior ?? vi.fn().mockResolvedValue("message-id-123"),
  } as unknown as import("firebase-admin/messaging").Messaging;
}

function createMockDb() {
  return {} as unknown as import("@oboapp/db").OboDb;
}

describe("notification-sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildNotificationPayload", () => {
    const baseMessage: Message = {
      id: "aB3xYz12",
      text: "Test message",
      aiProcessed: false,
      locality: "bg.sofia",
      createdAt: "2026-02-05T12:00:00.000Z",
    };

    const baseMatch: NotificationMatch = {
      id: "match123",
      messageId: "aB3xYz12",
      userId: "user123",
      interestId: "int123",
      matchedAt: "2026-02-05T12:00:00.000Z",
      notified: false,
      distance: 250,
    };

    it("should truncate long messages to 100 characters", () => {
      const longMessage: Message = {
        ...baseMessage,
        text: "a".repeat(150),
      };

      const payload = buildNotificationPayload(longMessage, baseMatch);

      expect(payload.data.body).toContain("...");
      expect(payload.data.body.length).toBeLessThan(150);
    });

    it("should include distance in body when present", () => {
      const payload = buildNotificationPayload(baseMessage, baseMatch);

      expect(payload.data.body).toContain("250m от вашия район");
    });

    it("should not include distance when null", () => {
      const matchWithoutDistance: NotificationMatch = {
        ...baseMatch,
        distance: undefined,
      };

      const payload = buildNotificationPayload(
        baseMessage,
        matchWithoutDistance,
      );

      expect(payload.data.body).not.toContain("от вашия район");
      expect(payload.data.body).toBe("Test message");
    });

    it("should include all required FCM data fields", () => {
      const payload = buildNotificationPayload(baseMessage, baseMatch);

      expect(payload.data).toHaveProperty("title");
      expect(payload.data).toHaveProperty("body");
      expect(payload.data).toHaveProperty("icon");
      expect(payload.data).toHaveProperty("badge");
      expect(payload.data).toHaveProperty("messageId", "aB3xYz12");
      expect(payload.data).toHaveProperty("interestId", "int123");
      expect(payload.data).toHaveProperty("matchId", "match123");
      expect(payload.data).toHaveProperty("url");
    });

    it("should use message ID in URL (ID is the slug)", () => {
      const payload = buildNotificationPayload(baseMessage, baseMatch);

      expect(payload.data.url).toContain("/m/aB3xYz12");
      expect(payload.webpush.fcmOptions.link).toContain("/m/aB3xYz12");
    });

    it("should strip markdown bold formatting from message text", () => {
      const markdownMessage: Message = {
        ...baseMessage,
        text: "**планирано**\n\n**Населено място:** София",
      };

      const payload = buildNotificationPayload(markdownMessage, {
        ...baseMatch,
        distance: undefined,
      });

      expect(payload.data.body).not.toContain("**");
      expect(payload.data.body).toContain("планирано");
      expect(payload.data.body).toContain("Населено място: София");
    });

    it("should strip headings, italic, links, and list markers", () => {
      const markdownMessage: Message = {
        ...baseMessage,
        text: "## Предупреждение\n- Първо\n- _Второ_\n[линк](https://example.com)",
      };

      const payload = buildNotificationPayload(markdownMessage, {
        ...baseMatch,
        distance: undefined,
      });

      expect(payload.data.body).not.toContain("##");
      expect(payload.data.body).not.toContain("- ");
      expect(payload.data.body).not.toContain("_");
      expect(payload.data.body).not.toContain("[линк]");
      expect(payload.data.body).not.toContain("https://example.com");
      expect(payload.data.body).toContain("Предупреждение");
      expect(payload.data.body).toContain("Първо");
      expect(payload.data.body).toContain("Второ");
      expect(payload.data.body).toContain("линк");
    });
  });

  describe("sendPushNotification", () => {
    const baseMessage: Message = {
      id: "msg1",
      text: "Test message",
      aiProcessed: false,
      locality: "bg.sofia",
      createdAt: "2026-02-05T12:00:00.000Z",
    };

    const baseMatch: NotificationMatch = {
      id: "match1",
      messageId: "msg1",
      userId: "user1",
      interestId: "int1",
      matchedAt: "2026-02-05T12:00:00.000Z",
      notified: false,
      distance: 100,
    };

    const baseSubscription: NotificationSubscription = {
      id: "sub123",
      userId: "user1",
      token: "fcm-token-abc",
      endpoint: "https://push.example.com",
      createdAt: "2026-02-05T12:00:00.000Z",
      updatedAt: "2026-02-05T12:00:00.000Z",
    };

    it("should return success when FCM send succeeds", async () => {
      const db = createMockDb();
      const messaging = createMockMessaging();

      const result = await sendPushNotification(
        db,
        messaging,
        baseSubscription,
        baseMessage,
        baseMatch,
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.tokenInvalid).toBeUndefined();
    });

    it("should delete subscription when token is not registered", async () => {
      const db = createMockDb();
      const error = new Error("Requested entity was not found.");
      (error as { code?: string }).code =
        "messaging/registration-token-not-registered";
      const messaging = createMockMessaging(() => Promise.reject(error));

      const result = await sendPushNotification(
        db,
        messaging,
        baseSubscription,
        baseMessage,
        baseMatch,
      );

      expect(result.success).toBe(false);
      expect(result.tokenInvalid).toBe(true);
      expect(mockDeleteSubscription).toHaveBeenCalledWith(db, "sub123");
    });

    it("should delete subscription when token is invalid", async () => {
      const db = createMockDb();
      const error = new Error("Invalid registration token");
      (error as { code?: string }).code =
        "messaging/invalid-registration-token";
      const messaging = createMockMessaging(() => Promise.reject(error));

      const result = await sendPushNotification(
        db,
        messaging,
        baseSubscription,
        baseMessage,
        baseMatch,
      );

      expect(result.success).toBe(false);
      expect(result.tokenInvalid).toBe(true);
      expect(mockDeleteSubscription).toHaveBeenCalledWith(db, "sub123");
    });

    it("should not delete subscription for other FCM errors", async () => {
      const db = createMockDb();
      const error = new Error("Server error");
      (error as { code?: string }).code = "messaging/internal-error";
      const messaging = createMockMessaging(() => Promise.reject(error));

      const result = await sendPushNotification(
        db,
        messaging,
        baseSubscription,
        baseMessage,
        baseMatch,
      );

      expect(result.success).toBe(false);
      expect(result.tokenInvalid).toBe(false);
      expect(mockDeleteSubscription).not.toHaveBeenCalled();
    });

    it("should not attempt delete when subscription has no id", async () => {
      const db = createMockDb();
      const error = new Error("Requested entity was not found.");
      (error as { code?: string }).code =
        "messaging/registration-token-not-registered";
      const messaging = createMockMessaging(() => Promise.reject(error));

      const subscriptionWithoutId: NotificationSubscription = {
        ...baseSubscription,
        id: undefined,
      };

      const result = await sendPushNotification(
        db,
        messaging,
        subscriptionWithoutId,
        baseMessage,
        baseMatch,
      );

      expect(result.success).toBe(false);
      expect(result.tokenInvalid).toBe(true);
      expect(mockDeleteSubscription).not.toHaveBeenCalled();
    });
  });

  describe("sendToUserDevices", () => {
    const baseMessage: Message = {
      id: "msg1",
      text: "Test message",
      aiProcessed: false,
      locality: "bg.sofia",
      createdAt: "2026-02-05T12:00:00.000Z",
    };

    const baseMatch: NotificationMatch = {
      id: "match1",
      messageId: "msg1",
      userId: "user1",
      interestId: "int1",
      matchedAt: "2026-02-05T12:00:00.000Z",
      notified: false,
      distance: 100,
    };

    it("should return zero count when user has no subscriptions", async () => {
      const db = createMockDb();
      const messaging = createMockMessaging();
      mockGetUserSubscriptions.mockResolvedValue([]);

      const result = await sendToUserDevices(
        db,
        messaging,
        "user1",
        baseMessage,
        baseMatch,
      );

      expect(result.successCount).toBe(0);
      expect(result.notifications).toHaveLength(0);
    });

    it("should clean up stale tokens and continue sending to valid devices", async () => {
      const db = createMockDb();

      const staleToken: NotificationSubscription = {
        id: "sub-stale",
        userId: "user1",
        token: "expired-token",
        endpoint: "https://push.example.com/1",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      };

      const validToken: NotificationSubscription = {
        id: "sub-valid",
        userId: "user1",
        token: "valid-token",
        endpoint: "https://push.example.com/2",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      };

      mockGetUserSubscriptions.mockResolvedValue([staleToken, validToken]);

      const staleError = new Error("Requested entity was not found.");
      (staleError as { code?: string }).code =
        "messaging/registration-token-not-registered";

      let callCount = 0;
      const messaging = createMockMessaging(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(staleError);
        return Promise.resolve("ok");
      });

      const result = await sendToUserDevices(
        db,
        messaging,
        "user1",
        baseMessage,
        baseMatch,
      );

      expect(result.successCount).toBe(1);
      expect(result.notifications).toHaveLength(2);
      expect(result.notifications[0].success).toBe(false);
      expect(result.notifications[1].success).toBe(true);
      expect(mockDeleteSubscription).toHaveBeenCalledWith(db, "sub-stale");
    });
  });
});
