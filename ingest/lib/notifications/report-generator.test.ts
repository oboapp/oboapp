import { describe, expect, it, vi } from "vitest";
import type { OboDb } from "@oboapp/db";
import { NotificationsReportSnapshotSchema } from "@oboapp/shared";
import { generateNotificationsReport } from "./report-generator";

const generatedAt = new Date("2026-10-02T12:00:00.000Z");

function makeDb(
  pages: Record<string, unknown>[][],
  messages: Record<string, unknown>[] = [],
) {
  const findNotifiedPage = vi.fn();
  for (const page of pages)
    findNotifiedPage.mockResolvedValueOnce({
      documents: page,
      nextCursor: page.length
        ? { backend: "firestore", value: page.at(-1)?._id }
        : null,
    });
  const findMany = vi.fn().mockResolvedValue(messages);
  const db = {
    notificationMatches: { findNotifiedPage },
    messages: { findMany },
  } as unknown as Pick<OboDb, "notificationMatches" | "messages">;
  return { db, findNotifiedPage, findMany };
}

describe("generateNotificationsReport", () => {
  it("counts one successful notification across devices and separates failed, unsubscribed and unknown records", async () => {
    const { db } = makeDb([
      [
        {
          _id: "1",
          userId: "u1",
          deviceNotifications: [
            { success: true },
            { success: true },
            { success: false },
          ],
          clickedAt: "2026-09-01T10:00:00Z",
          openedAt: "2026-09-02T10:00:00Z",
          notifiedAt: new Date("2026-09-01T08:00:00Z"),
          messageSnapshot: { source: "a" },
        },
        {
          _id: "2",
          userId: "u1",
          deviceNotifications: [{ success: true }],
          notifiedAt: "2026-09-03T08:00:00Z",
          messageSnapshot: { source: "a" },
        },
        {
          _id: "3",
          userId: "u2",
          deviceNotifications: [{ success: false }],
          clickedAt: "2026-01-01",
          messageSnapshot: { source: "b" },
        },
        {
          _id: "4",
          userId: "u3",
          deviceNotifications: [],
          messageSnapshot: { source: "b" },
        },
        {
          _id: "5",
          userId: "u4",
          openedAt: "2026-01-01",
          notifiedAt: "bad",
          messageSnapshot: { source: "b" },
        },
        {
          _id: "6",
          deviceNotifications: [{ success: "true" }],
          messageSnapshot: { source: "b" },
        },
      ],
    ]);
    const report = await generateNotificationsReport(db, generatedAt);
    expect(report.kpis).toEqual({
      processed: 6,
      sent: 2,
      uniqueUsers: 1,
      clicked: 1,
      opened: 1,
      failed: 1,
      noSubscriptions: 1,
      unknownDelivery: 2,
    });
    expect(report.periodStart).toBe("2026-09-01T08:00:00.000Z");
    expect(report.periodEnd).toBe("2026-09-03T08:00:00.000Z");
    expect(report.firstRecordedClickAt).toBe("2026-09-01T10:00:00.000Z");
    expect(report.sources[0]).toMatchObject({
      source: "a",
      sent: 2,
      clicked: 1,
      opened: 1,
    });
    expect(NotificationsReportSnapshotSchema.safeParse(report).success).toBe(
      true,
    );
    expect(JSON.stringify(report)).not.toContain("u1");
    expect(JSON.stringify(report)).not.toContain("deviceNotifications");
  });

  it("handles empty reports and missing or invalid dates without inventing tracking dates", async () => {
    const { db } = makeDb([[]]);
    const report = await generateNotificationsReport(db, generatedAt);
    expect(report.kpis.processed).toBe(0);
    expect(report.periodStart).toBeNull();
    expect(report.periodEnd).toBeNull();
    expect(report.firstRecordedClickAt).toBeNull();
    expect(report.sources).toEqual([]);
  });

  it("advances full pages and looks up only missing sources in sequential batches of ten", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      _id: String(index).padStart(4, "0"),
      messageId: `m${index}`,
      deviceNotifications: [{ success: true }],
      messageSnapshot: index < 25 ? {} : { source: "snapshot-source" },
    }));
    const { db, findNotifiedPage, findMany } = makeDb(
      [firstPage, [{ _id: "0500", messageId: "deleted" }]],
      [{ _id: "m0", source: "fallback-source" }],
    );
    const report = await generateNotificationsReport(db, generatedAt);
    expect(findNotifiedPage.mock.calls).toEqual([
      [500, undefined],
      [500, { backend: "firestore", value: "0499" }],
    ]);
    expect(
      findMany.mock.calls.map(([options]) => options.where[0].value.length),
    ).toEqual([10, 10, 5, 1]);
    expect(findMany.mock.calls[0][0].select).toEqual(["source"]);
    expect(report.kpis.processed).toBe(501);
    expect(
      report.sources.find((source) => source.source === "fallback-source")
        ?.sent,
    ).toBe(1);
    expect(
      report.sources.find((source) => source.source === "(unknown)")?.processed,
    ).toBe(25);
  });

  it("fails rather than publishing a partial report when a page read fails", async () => {
    const { db, findNotifiedPage } = makeDb([]);
    findNotifiedPage.mockRejectedValue(new Error("database unavailable"));
    await expect(generateNotificationsReport(db)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("rejects non-advancing cursors", async () => {
    const page = Array.from({ length: 500 }, () => ({ _id: "same-id" }));
    const { db } = makeDb([page, page]);
    await expect(generateNotificationsReport(db)).rejects.toThrow(
      "cursor did not advance",
    );
  });

  it("passes opaque native cursors through even when public IDs repeat across BSON types", async () => {
    const { db, findNotifiedPage } = makeDb([]);
    const publicId = "0123456789abcdef01234567";
    const stringCursor = { backend: "mongodb", value: publicId };
    const nativeCursor = { backend: "mongodb", value: { nativeId: publicId } };
    findNotifiedPage
      .mockResolvedValueOnce({
        documents: Array.from({ length: 500 }, () => ({ _id: publicId })),
        nextCursor: stringCursor,
      })
      .mockResolvedValueOnce({
        documents: [{ _id: publicId }],
        nextCursor: nativeCursor,
      });
    const report = await generateNotificationsReport(db, generatedAt);
    expect(report.kpis.processed).toBe(501);
    expect(findNotifiedPage.mock.calls[1][1]).toBe(stringCursor);
  });
});
