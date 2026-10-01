import { describe, expect, it, vi } from "vitest";
import type { OboDb } from "@oboapp/db";
import type { Messaging } from "firebase-admin/messaging";

const mocks = vi.hoisted(() => ({
  getUnprocessedMessages: vi.fn(),
  markMessagesAsNotified: vi.fn(),
  getAllInterests: vi.fn(),
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
  getUnnotifiedMatches: mocks.getUnnotifiedMatches,
}));
vi.mock("./notification-sender", () => ({
  sendToUserDevices: mocks.sendToUserDevices,
  updateMatchWithResults: mocks.updateMatchWithResults,
  markMatchesAsNotified: mocks.markMatchesAsNotified,
}));

import { processNotificationWork } from "./match-and-notify";

describe("processNotificationWork()", () => {
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
