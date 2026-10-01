import { describe, it, expect, vi } from "vitest";
import type { OboDb } from "@oboapp/db";

import {
  getUnprocessedMessages,
  isMessageStale,
  MESSAGE_BATCH_SIZE,
} from "./message-fetcher";

describe("isMessageStale()", () => {
  const now = new Date("2026-05-19T10:00:00.000Z");

  it("returns false when timespanEnd is undefined", () => {
    expect(isMessageStale(undefined, now)).toBe(false);
  });

  it("returns false when timespanEnd is an empty string", () => {
    expect(isMessageStale("", now)).toBe(false);
  });

  it("returns false when timespanEnd is unparseable", () => {
    expect(isMessageStale("not-a-date", now)).toBe(false);
  });

  it("returns true when timespanEnd is strictly in the past", () => {
    expect(isMessageStale("2026-05-18T23:59:00.000Z", now)).toBe(true);
  });

  it("returns false when timespanEnd is in the future", () => {
    expect(isMessageStale("2026-05-20T12:00:00.000Z", now)).toBe(false);
  });

  it("returns false when timespanEnd equals now exactly (boundary: not stale)", () => {
    expect(isMessageStale(now.toISOString(), now)).toBe(false);
  });

  it("returns true for an ISO string one millisecond before now", () => {
    const oneMs = new Date(now.getTime() - 1);
    expect(isMessageStale(oneMs.toISOString(), now)).toBe(true);
  });

  it("accepts a Date object — returns true when the Date is in the past", () => {
    expect(isMessageStale(new Date("2026-05-18T23:59:00.000Z"), now)).toBe(true);
  });

  it("accepts a Date object — returns false when the Date is in the future", () => {
    expect(isMessageStale(new Date("2026-05-20T00:00:00.000Z"), now)).toBe(false);
  });
});

describe("getUnprocessedMessages()", () => {
  it("fetches only a bounded projection needed for matching", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        _id: "message-1",
        createdAt: new Date("2026-10-01T10:00:00Z"),
        locality: "bg.sofia",
        source: "source-1",
      },
    ]);
    const db = { messages: { findMany, updateOne: vi.fn() } } as unknown as OboDb;

    const messages = await getUnprocessedMessages(db);

    expect(findMany).toHaveBeenCalledWith({
      where: [{ field: "notificationsSent", op: "!=", value: true }],
      orderBy: [{ field: "createdAt", direction: "asc" }],
      limit: MESSAGE_BATCH_SIZE,
      select: [
        "createdAt",
        "geoJson",
        "locality",
        "cityWide",
        "source",
        "categories",
        "timespanEnd",
      ],
    });
    expect(messages).toEqual([
      {
        id: "message-1",
        createdAt: "2026-10-01T10:00:00.000Z",
        locality: "bg.sofia",
        cityWide: false,
        geoJson: undefined,
        source: "source-1",
        categories: undefined,
        timespanEnd: undefined,
      },
    ]);
  });

  it("clears expired messages from the oldest page", async () => {
    const updateOne = vi.fn().mockResolvedValue(undefined);
    const db = {
      messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            _id: "expired",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            timespanEnd: new Date("2026-01-02T00:00:00Z"),
          },
        ]),
        updateOne,
      },
    } as unknown as OboDb;

    expect(await getUnprocessedMessages(db)).toEqual([]);
    expect(updateOne).toHaveBeenCalledWith(
      "expired",
      expect.objectContaining({ notificationsSent: true }),
    );
  });
});
