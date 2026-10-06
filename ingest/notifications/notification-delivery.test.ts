import { describe, expect, it, vi } from "vitest";
import type { OboDb } from "@oboapp/db";
import type { Messaging } from "firebase-admin/messaging";
import { processNotificationWork } from "./match-and-notify";

describe("scheduled notification delivery", () => {
  it.each([
    {
      label: "NIMH",
      source: "nimh-severe-weather",
      icon: "/sources/nimh-severe-weather.png",
    },
    {
      label: "another source",
      source: "sofia-bg",
      icon: "/sources/sofia-bg.png",
    },
    {
      label: "missing source",
      source: undefined,
      icon: "/icon-192x192.png",
    },
    { label: "empty source", source: "", icon: "/icon-192x192.png" },
    { label: "invalid source", source: 123, icon: "/icon-192x192.png" },
  ])("sends the expected icon for $label", async ({ source, icon }) => {
    const findById = vi.fn().mockResolvedValue({
      locality: "bg.sofia",
      text: "Weather warning",
      createdAt: "2026-10-06T08:00:00Z",
      ...(source === undefined ? {} : { source }),
    });
    const db = {
      messages: { findMany: vi.fn().mockResolvedValue([]), findById },
      notificationMatches: {
        findUnnotified: vi.fn().mockResolvedValue([
          {
            _id: "match-1",
            userId: "user-1",
            messageId: "message-1",
            interestId: "interest-1",
            matchedAt: "2026-10-06T08:00:00Z",
            notified: false,
          },
        ]),
        updateOne: vi.fn().mockResolvedValue(undefined),
      },
      notificationSubscriptions: {
        findByUserId: vi.fn().mockResolvedValue([
          {
            _id: "device-1",
            userId: "user-1",
            token: "device-token",
          },
        ]),
      },
    } as unknown as OboDb;
    const send = vi.fn().mockResolvedValue("fcm-message-id");
    const messaging = { send } as unknown as Messaging;

    await processNotificationWork(db, messaging);

    expect(findById).toHaveBeenCalledWith("message-1");
    expect(send).toHaveBeenCalledExactlyOnceWith({
      token: "device-token",
      data: expect.objectContaining({
        senderIcon: expect.stringContaining(icon),
        icon: expect.stringContaining("/icon-192x192.png"),
        badge: expect.stringContaining("/icon-72x72.png"),
        messageId: "message-1",
        matchId: "match-1",
        url: expect.stringContaining("/n/match-1"),
      }),
      webpush: { fcmOptions: { link: expect.stringContaining("/n/match-1") } },
    });
  });
});
