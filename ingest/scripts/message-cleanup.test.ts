import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deleteMessagesWithRelations,
  logCleanupStats,
} from "./message-cleanup";

// Minimal mock builder for the db repos used by deleteMessagesWithRelations
function createMockDb() {
  return {
    messages: { deleteOne: vi.fn() },
    events: { deleteOne: vi.fn() },
    eventMessages: {
      findByMessageId: vi.fn().mockResolvedValue([]),
      findByEventId: vi.fn().mockResolvedValue([]),
      deleteOne: vi.fn(),
    },
    notificationMatches: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteOne: vi.fn(),
    },
  };
}

type MockDb = ReturnType<typeof createMockDb>;

describe("deleteMessagesWithRelations", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("deletes messages with no related records", async () => {
    const messages = [{ _id: "msg1" }, { _id: "msg2" }];

    const stats = await deleteMessagesWithRelations(db as never, messages);

    expect(stats.messagesDeleted).toBe(2);
    expect(stats.eventMessagesDeleted).toBe(0);
    expect(stats.orphanedEventsDeleted).toBe(0);
    expect(stats.notificationMatchesDeleted).toBe(0);
    expect(db.messages.deleteOne).toHaveBeenCalledTimes(2);
  });

  it("deletes event links and orphaned event when it was the only message", async () => {
    db.eventMessages.findByMessageId.mockResolvedValue([
      { _id: "em1", eventId: "evt1" },
    ]);
    // After link deletion, no remaining links for the event
    db.eventMessages.findByEventId.mockResolvedValue([]);

    const stats = await deleteMessagesWithRelations(db as never, [
      { _id: "msg1" },
    ]);

    expect(stats.eventMessagesDeleted).toBe(1);
    expect(stats.orphanedEventsDeleted).toBe(1);
    expect(db.events.deleteOne).toHaveBeenCalledWith("evt1");
  });

  it("preserves event when other messages still link to it", async () => {
    db.eventMessages.findByMessageId.mockResolvedValue([
      { _id: "em1", eventId: "evt1" },
    ]);
    // Another message still links to this event
    db.eventMessages.findByEventId.mockResolvedValue([
      { _id: "em-other", messageId: "msg-other", eventId: "evt1" },
    ]);

    const stats = await deleteMessagesWithRelations(db as never, [
      { _id: "msg1" },
    ]);

    expect(stats.eventMessagesDeleted).toBe(1);
    expect(stats.orphanedEventsDeleted).toBe(0);
    expect(db.events.deleteOne).not.toHaveBeenCalled();
  });

  it("defers orphan check when siblings share the same event", async () => {
    // Two sibling messages both linked to the same event
    db.eventMessages.findByMessageId
      .mockResolvedValueOnce([{ _id: "em1", eventId: "evt1" }])
      .mockResolvedValueOnce([{ _id: "em2", eventId: "evt1" }]);
    // After both links are deleted, no remaining links
    db.eventMessages.findByEventId.mockResolvedValue([]);

    const stats = await deleteMessagesWithRelations(db as never, [
      { _id: "msg1" },
      { _id: "msg2" },
    ]);

    expect(stats.eventMessagesDeleted).toBe(2);
    // Event should be deleted exactly once, not twice
    expect(stats.orphanedEventsDeleted).toBe(1);
    expect(db.events.deleteOne).toHaveBeenCalledTimes(1);
    expect(db.events.deleteOne).toHaveBeenCalledWith("evt1");
  });

  it("deletes notification matches", async () => {
    db.notificationMatches.findMany.mockResolvedValue([
      { _id: "nm1" },
      { _id: "nm2" },
    ]);

    const stats = await deleteMessagesWithRelations(db as never, [
      { _id: "msg1" },
    ]);

    expect(stats.notificationMatchesDeleted).toBe(2);
    expect(db.notificationMatches.deleteOne).toHaveBeenCalledWith("nm1");
    expect(db.notificationMatches.deleteOne).toHaveBeenCalledWith("nm2");
  });

  it("handles mixed scenario: multiple messages, events, and notifications", async () => {
    // msg1 links to evt1 (shared), msg2 links to evt1 (shared) and evt2 (unique)
    db.eventMessages.findByMessageId
      .mockResolvedValueOnce([{ _id: "em1", eventId: "evt1" }])
      .mockResolvedValueOnce([
        { _id: "em2", eventId: "evt1" },
        { _id: "em3", eventId: "evt2" },
      ]);

    // evt1 still has an external message, evt2 is orphaned
    db.eventMessages.findByEventId.mockImplementation(
      async (eventId: string) => {
        if (eventId === "evt1")
          return [{ _id: "em-ext", messageId: "msg-ext", eventId: "evt1" }];
        return []; // evt2 is orphaned
      },
    );

    db.notificationMatches.findMany
      .mockResolvedValueOnce([{ _id: "nm1" }])
      .mockResolvedValueOnce([]);

    const stats = await deleteMessagesWithRelations(db as never, [
      { _id: "msg1" },
      { _id: "msg2" },
    ]);

    expect(stats.messagesDeleted).toBe(2);
    expect(stats.eventMessagesDeleted).toBe(3);
    expect(stats.orphanedEventsDeleted).toBe(1); // only evt2
    expect(stats.notificationMatchesDeleted).toBe(1);
    expect(db.events.deleteOne).toHaveBeenCalledWith("evt2");
    expect(db.events.deleteOne).not.toHaveBeenCalledWith("evt1");
  });
});

describe("logCleanupStats", () => {
  it("logs formatted stats with indent", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logCleanupStats(
      {
        messagesDeleted: 2,
        eventMessagesDeleted: 1,
        orphanedEventsDeleted: 0,
        notificationMatchesDeleted: 3,
      },
      "  ",
    );

    expect(spy).toHaveBeenCalledWith(
      "  Deleted: 2 message(s), 1 event link(s), 0 orphaned event(s), 3 notification match(es)",
    );
    spy.mockRestore();
  });
});
