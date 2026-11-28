import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessagesRepository, type DbClient, type OboDb } from "@oboapp/db";
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

  it("loads shared messages once and delivers pending matches in user order", async () => {
    const firstUser = {
      id: "match-1",
      messageId: "message-1",
      userId: "user-1",
      distance: 25,
    };
    const closer = { ...firstUser, id: "match-2", distance: 5 };
    const secondUser = { id: "match-3", messageId: "message-1", userId: "user-2" };
    const otherMessage = { id: "match-4", messageId: "message-2", userId: "user-2" };
    mocks.getUnprocessedMessages.mockResolvedValueOnce([]);
    mocks.getUnnotifiedMatches.mockResolvedValueOnce([
      firstUser,
      secondUser,
      otherMessage,
      closer,
      { id: "match-5", messageId: "deleted", userId: "user-1" },
      { id: "match-6", messageId: "no-locality", userId: "user-1" },
      { messageId: "no-match-id", userId: "user-1" },
    ]);
    const notifications = [{ subscriptionId: "device-1", success: true }];
    mocks.sendToUserDevices.mockResolvedValue({ successCount: 1, notifications });
    const firstRecord = {
      _id: "message-1",
      locality: "bg.sofia",
      text: "Notification body",
    };
    const secondRecord = { ...firstRecord, _id: "message-2", text: "Another body" };
    const findMany = vi.fn().mockResolvedValue([
      secondRecord,
      { _id: "no-locality" },
      firstRecord,
    ]);
    const messages = new MessagesRepository({ findMany } as unknown as DbClient);
    const db = { messages } as OboDb;
    const messaging = {} as Messaging;

    await processNotificationWork(db, messaging);

    expect(mocks.getAllInterests).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledExactlyOnceWith("messages", {
      where: [{
        field: "_id",
        op: "in",
        value: ["message-1", "message-2", "deleted", "no-locality"],
      }],
    });
    expect(mocks.sendToUserDevices).toHaveBeenCalledTimes(3);
    const expectedDeliveries = [
      { match: closer, record: firstRecord },
      { match: secondUser, record: firstRecord },
      { match: otherMessage, record: secondRecord },
    ];
    for (const [index, { match, record }] of expectedDeliveries.entries()) {
      expect(mocks.sendToUserDevices).toHaveBeenNthCalledWith(
        index + 1,
        db,
        messaging,
        match.userId,
        expect.objectContaining({ id: record._id, text: record.text }),
        match,
      );
      expect(mocks.updateMatchWithResults).toHaveBeenNthCalledWith(
        index + 1,
        db,
        match.id,
        record,
        notifications,
      );
    }
    expect(mocks.markMatchesAsNotified).toHaveBeenCalledWith(db, [
      "match-1", "match-3", "match-4", "match-2", "match-5", "match-6",
    ]);
  });

  it("leaves the entire page pending if a message batch cannot be read", async () => {
    const pending = Array.from({ length: 31 }, (_, index) => ({
      id: `match-${index}`,
      messageId: `message-${index}`,
      userId: "user-1",
    }));
    mocks.getUnprocessedMessages.mockResolvedValueOnce([]);
    mocks.getUnnotifiedMatches.mockResolvedValueOnce(pending);
    const error = new Error("Database unavailable");
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ _id: "message-0", locality: "bg.sofia", text: "First" }])
      .mockRejectedValueOnce(error);
    const messages = new MessagesRepository({ findMany } as unknown as DbClient);

    await expect(processNotificationWork({ messages } as OboDb, {} as Messaging))
      .rejects.toBe(error);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(mocks.sendToUserDevices).not.toHaveBeenCalled();
    expect(mocks.updateMatchWithResults).not.toHaveBeenCalled();
    expect(mocks.markMatchesAsNotified).not.toHaveBeenCalled();
  });
});
