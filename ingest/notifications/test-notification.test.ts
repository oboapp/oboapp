import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./subscription-manager", () => ({
  getUserSubscriptions: vi.fn(),
}));
vi.mock("./notification-sender", () => ({
  buildNotificationPayload: vi.fn(() => ({
    data: { senderIcon: "https://oboapp.bg/sources/sofiyska-voda.png" },
  })),
  sendToUserDevices: vi.fn(),
}));

import {
  buildNotificationPayload,
  sendToUserDevices,
} from "./notification-sender";
import { getUserSubscriptions } from "./subscription-manager";
import {
  createTestNotificationMatch,
  sendTestNotification,
  toNotificationMessage,
} from "./test-notification";

const mockBuildNotificationPayload = vi.mocked(buildNotificationPayload);
const mockGetUserSubscriptions = vi.mocked(getUserSubscriptions);
const mockSendToUserDevices = vi.mocked(sendToUserDevices);

function createMockDb(message: Record<string, unknown> | null) {
  return {
    messages: {
      findById: vi.fn().mockResolvedValue(message),
    },
  } as unknown as import("@oboapp/db").OboDb;
}

const messageData = {
  _id: "message-1",
  text: "Спиране на водата",
  locality: "bg.sofia",
  source: "sofiyska-voda",
  createdAt: "2026-07-11T10:00:00.000Z",
};

describe("test notification sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserSubscriptions.mockResolvedValue([]);
  });

  it("retains the stored message source for the notification avatar", () => {
    expect(toNotificationMessage("message-1", messageData)).toMatchObject({
      id: "message-1",
      text: "Спиране на водата",
      source: "sofiyska-voda",
    });
  });

  it("rejects a stored message without its required locality", () => {
    expect(
      toNotificationMessage("message-1", { text: "Missing locality" }),
    ).toBeNull();
  });

  it("uses a non-persistent match so a test send does not alter notification history", () => {
    expect(createTestNotificationMatch("user-1", "message-1")).toEqual({
      userId: "user-1",
      messageId: "message-1",
      interestId: "test-notification",
      matchedAt: expect.any(Date),
      notified: false,
    });
  });

  it("reports a missing message without resolving device subscriptions", async () => {
    const result = await sendTestNotification(
      createMockDb(null),
      {} as import("firebase-admin/messaging").Messaging,
      "user-1",
      "missing-message",
      false,
    );

    expect(result).toEqual({ status: "message-not-found", deviceCount: 0 });
    expect(mockGetUserSubscriptions).not.toHaveBeenCalled();
  });

  it("previews the source icon and devices without sending by default", async () => {
    mockGetUserSubscriptions.mockResolvedValue([
      { id: "device-1" },
      { id: "device-2" },
    ] as never);

    const result = await sendTestNotification(
      createMockDb(messageData),
      {} as import("firebase-admin/messaging").Messaging,
      "user-1",
      "message-1",
      false,
    );

    expect(result).toEqual({
      status: "dry-run",
      deviceCount: 2,
      sourceIcon: "https://oboapp.bg/sources/sofiyska-voda.png",
    });
    expect(mockBuildNotificationPayload).toHaveBeenCalledWith(
      expect.objectContaining({ source: "sofiyska-voda" }),
      expect.objectContaining({ userId: "user-1", messageId: "message-1" }),
    );
    expect(mockSendToUserDevices).not.toHaveBeenCalled();
  });

  it("sends through the normal all-devices sender only with explicit execution", async () => {
    mockSendToUserDevices.mockResolvedValue({
      successCount: 1,
      notifications: [
        {
          subscriptionId: "device-1",
          sentAt: "2026-07-11T10:00:00.000Z",
          success: true,
        },
      ],
    });
    const messaging = {} as import("firebase-admin/messaging").Messaging;
    const db = createMockDb(messageData);

    const result = await sendTestNotification(
      db,
      messaging,
      "user-1",
      "message-1",
      true,
    );

    expect(result).toMatchObject({
      status: "sent",
      deviceCount: 1,
      successCount: 1,
    });
    expect(mockSendToUserDevices).toHaveBeenCalledWith(
      db,
      messaging,
      "user-1",
      expect.objectContaining({ id: "message-1" }),
      expect.objectContaining({
        notified: false,
        interestId: "test-notification",
      }),
    );
  });
});
