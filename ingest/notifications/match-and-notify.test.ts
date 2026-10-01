import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OboDb } from "@oboapp/db";
import type { Messaging } from "firebase-admin/messaging";

const mocks = vi.hoisted(() => ({
  getUnprocessedMessages: vi.fn(),
  markMessagesAsNotified: vi.fn(),
  getAllInterests: vi.fn(),
  matchMessagesWithInterests: vi.fn(),
  deduplicateMatches: vi.fn(),
  storeNotificationMatches: vi.fn(),
  getUnnotifiedMatches: vi.fn(),
  sendToUserDevices: vi.fn(),
  updateMatchWithResults: vi.fn(),
  markMatchesAsNotified: vi.fn(),
}));

vi.mock("./message-fetcher", () => ({
  getUnprocessedMessages: mocks.getUnprocessedMessages,
  markMessagesAsNotified: mocks.markMessagesAsNotified,
}));
vi.mock("./interest-fetcher", () => ({ getAllInterests: mocks.getAllInterests }));
vi.mock("./match-processor", () => ({
  matchMessagesWithInterests: mocks.matchMessagesWithInterests,
  deduplicateMatches: mocks.deduplicateMatches,
  storeNotificationMatches: mocks.storeNotificationMatches,
  getUnnotifiedMatches: mocks.getUnnotifiedMatches,
}));
vi.mock("./notification-sender", () => ({
  sendToUserDevices: mocks.sendToUserDevices,
  updateMatchWithResults: mocks.updateMatchWithResults,
  markMatchesAsNotified: mocks.markMatchesAsNotified,
}));

import { processNotificationWork } from "./match-and-notify";

describe("processNotificationWork()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUnnotifiedMatches.mockResolvedValue([]);
    mocks.markMessagesAsNotified.mockResolvedValue(undefined);
    mocks.storeNotificationMatches.mockResolvedValue(undefined);
  });

  it("marks new messages processed when no users have interests", async () => {
    mocks.getUnprocessedMessages.mockResolvedValueOnce([{ id: "message-1" }]);
    mocks.getAllInterests.mockResolvedValueOnce([]);
    const db = {} as OboDb;

    await processNotificationWork(db, {} as Messaging);

    expect(mocks.markMessagesAsNotified).toHaveBeenCalledWith(db, ["message-1"]);
    expect(mocks.getUnnotifiedMatches).toHaveBeenCalledWith(db);
    expect(mocks.matchMessagesWithInterests).not.toHaveBeenCalled();
  });

  it("stores matches before marking source messages and draining pending sends", async () => {
    const message = { id: "message-1" };
    const interest = { id: "interest-1", userId: "user-1" };
    const match = {
      messageId: "message-1",
      userId: "user-1",
      interestId: "interest-1",
      distance: 100,
    };
    mocks.getUnprocessedMessages.mockResolvedValueOnce([message]);
    mocks.getAllInterests.mockResolvedValueOnce([interest]);
    mocks.matchMessagesWithInterests.mockResolvedValueOnce([match]);
    mocks.deduplicateMatches.mockReturnValueOnce([match]);
    const findByUserIds = vi.fn().mockResolvedValue([
      {
        _id: "user-1",
        notificationCategories: ["traffic"],
        notificationSources: ["source-1"],
        experimentalFeatures: true,
      },
    ]);
    const db = {
      userPreferences: { findByUserIds },
    } as unknown as OboDb;

    await processNotificationWork(db, {} as Messaging);

    expect(findByUserIds).toHaveBeenCalledWith(["user-1"]);
    expect(mocks.matchMessagesWithInterests).toHaveBeenCalledWith(
      [message],
      [interest],
      new Map([
        [
          "user-1",
          {
            notificationCategories: new Set(["traffic"]),
            notificationSources: new Set(["source-1"]),
            experimentalFeatures: true,
          },
        ],
      ]),
    );
    expect(mocks.storeNotificationMatches).toHaveBeenCalledWith(db, [match]);
    expect(mocks.storeNotificationMatches.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markMessagesAsNotified.mock.invocationCallOrder[0],
    );
    expect(mocks.getUnnotifiedMatches).toHaveBeenCalledWith(db);
  });

  it("marks new messages processed when no matches are found", async () => {
    mocks.getUnprocessedMessages.mockResolvedValueOnce([{ id: "message-1" }]);
    mocks.getAllInterests.mockResolvedValueOnce([
      { id: "interest-1", userId: "user-1" },
    ]);
    mocks.matchMessagesWithInterests.mockResolvedValueOnce([]);
    const db = {
      userPreferences: { findByUserIds: vi.fn().mockResolvedValue([]) },
    } as unknown as OboDb;

    await processNotificationWork(db, {} as Messaging);

    expect(mocks.storeNotificationMatches).not.toHaveBeenCalled();
    expect(mocks.markMessagesAsNotified).toHaveBeenCalledWith(db, ["message-1"]);
  });

  it("sends pending matches even when there are no new messages", async () => {
    mocks.getUnprocessedMessages.mockResolvedValueOnce([]);
    mocks.getUnnotifiedMatches.mockResolvedValueOnce([
      {
        id: "match-1",
        userId: "user-1",
        messageId: "message-1",
        interestId: "interest-1",
        matchedAt: "2026-10-01T10:00:00Z",
        notified: false,
      },
    ]);
    mocks.sendToUserDevices.mockResolvedValueOnce({
      successCount: 1,
      notifications: [{ subscriptionId: "device-1", success: true }],
    });
    mocks.updateMatchWithResults.mockResolvedValueOnce(undefined);
    mocks.markMatchesAsNotified.mockResolvedValueOnce(undefined);
    const findById = vi.fn().mockResolvedValue({
      locality: "bg.sofia",
      text: "Notification body",
      createdAt: new Date("2026-10-01T10:00:00Z"),
    });
    const db = { messages: { findById } } as unknown as OboDb;

    await processNotificationWork(db, {} as Messaging);

    expect(mocks.getAllInterests).not.toHaveBeenCalled();
    expect(findById).toHaveBeenCalledWith("message-1");
    expect(mocks.sendToUserDevices).toHaveBeenCalledOnce();
    expect(mocks.markMatchesAsNotified).toHaveBeenCalledWith(db, ["match-1"]);
  });
});
