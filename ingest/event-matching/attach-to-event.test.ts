import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachMessageToEvent } from "./attach-to-event";

vi.mock("@/lib/source-trust", () => ({
  getSourceTrust: vi.fn((source: string) => {
    if (source === "toplo-bg") return { trust: 1.0, geometryQuality: 3 };
    if (source === "sofia-bg") return { trust: 0.8, geometryQuality: 2 };
    return { trust: 0.5, geometryQuality: 0 };
  }),
  getGeometryQuality: vi.fn((source: string, hasPrecomputed: boolean) => {
    if (hasPrecomputed) return 3;
    if (source === "toplo-bg") return 3;
    if (source === "sofia-bg") return 2;
    return 0;
  }),
}));

const mockInsertEventMessage = vi.fn().mockResolvedValue("em-new");
const mockCreateEventMessage = vi.fn().mockResolvedValue("msg-2");
const mockUpdateEvent = vi.fn().mockResolvedValue(undefined);
const mockFindByMessageId = vi.fn().mockResolvedValue([]);
const mockFindByEventId = vi.fn().mockResolvedValue([]);
const mockFindEventById = vi.fn().mockResolvedValue(null);
const mockDb = {
  eventMessages: {
    insertOne: mockInsertEventMessage,
    createOne: mockCreateEventMessage,
    findByMessageId: mockFindByMessageId,
    findByEventId: mockFindByEventId,
  },
  events: { updateOne: mockUpdateEvent, findById: mockFindEventById },
} as any;

const baseSignals = { locationSimilarity: 0.9, timeOverlap: 0.8, categoryMatch: 1.0, textSimilarity: 0 };

describe("attachMessageToEvent", () => {
  beforeEach(() => {
    mockInsertEventMessage.mockClear();
    mockCreateEventMessage.mockClear().mockResolvedValue("msg-2");
    mockUpdateEvent.mockClear();
    mockFindByMessageId.mockClear().mockResolvedValue([]);
    mockFindByEventId.mockClear().mockResolvedValue([]);
    mockFindEventById.mockClear().mockResolvedValue(null);
  });

  it("skips when message is already linked to a different event", async () => {
    mockFindByMessageId.mockResolvedValueOnce([{ eventId: "evt-other" }]);

    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg" },
      { _id: "evt-1", geometryQuality: 3, sources: ["toplo-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    expect(mockCreateEventMessage).not.toHaveBeenCalled();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("repairs event doc when link already exists for the same event", async () => {
    mockFindByMessageId.mockResolvedValueOnce([{ eventId: "evt-1" }]);
    // Simulate 2 links already in the collection
    mockFindByEventId.mockResolvedValueOnce([{ messageId: "msg-1" }, { messageId: "msg-2" }]);

    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg" },
      { _id: "evt-1", geometryQuality: 3, sources: ["toplo-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    // Link creation skipped
    expect(mockCreateEventMessage).not.toHaveBeenCalled();
    // Event doc updated with recount instead of $inc
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$inc).toBeUndefined();
    expect(update.$set.messageCount).toBe(2);
  });

  it("creates EventMessage link with signals", async () => {
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg" },
      { _id: "evt-1", geometryQuality: 3, sources: ["toplo-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    const emData = mockCreateEventMessage.mock.calls[0][0];
    expect(emData.eventId).toBe("evt-1");
    expect(emData.messageId).toBe("msg-2");
    expect(emData.confidence).toBe(0.85);
    expect(emData.matchSignals).toEqual(baseSignals);
    expect(mockCreateEventMessage.mock.calls[0][1]).toBe("msg-2");
  });

  it("repairs event doc when createOne throws already-exists (concurrent worker)", async () => {
    const duplicate = new Error("Document already exists");
    (duplicate as { code?: unknown }).code = "already-exists";
    mockCreateEventMessage.mockRejectedValueOnce(duplicate);
    // Simulate 1 link already committed by the concurrent worker
    mockFindByEventId.mockResolvedValueOnce([{ messageId: "msg-2" }]);

    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg" },
      { _id: "evt-1", geometryQuality: 3, sources: ["toplo-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    // Event doc must be repaired with recount, not skipped
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$inc).toBeUndefined();
    expect(update.$set.messageCount).toBe(1);
  });

  it("increments messageCount atomically", async () => {
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg" },
      { _id: "evt-1", geometryQuality: 3, sources: ["toplo-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$inc).toEqual({ messageCount: 1 });
  });

  it("merges timespans (expands to union)", async () => {
    await attachMessageToEvent(
      mockDb,
      {
        _id: "msg-2",
        source: "sofia-bg",
        timespanStart: "2025-03-01T06:00:00Z", // earlier
        timespanEnd: "2025-03-01T20:00:00Z",   // later
      },
      {
        _id: "evt-1",
        geometryQuality: 2,
        sources: ["toplo-bg"],
        messageCount: 1,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
      },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$set.timespanStart).toBe("2025-03-01T06:00:00Z");
    expect(update.$set.timespanEnd).toBe("2025-03-01T20:00:00Z");
  });

  it("does not shrink timespans when message is narrower", async () => {
    await attachMessageToEvent(
      mockDb,
      {
        _id: "msg-2",
        source: "sofia-bg",
        timespanStart: "2025-03-01T10:00:00Z", // later start
        timespanEnd: "2025-03-01T16:00:00Z",   // earlier end
      },
      {
        _id: "evt-1",
        geometryQuality: 2,
        sources: [],
        messageCount: 1,
        timespanStart: "2025-03-01T08:00:00Z",
        timespanEnd: "2025-03-01T18:00:00Z",
      },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$set.timespanStart).toBeUndefined(); // not updated
    expect(update.$set.timespanEnd).toBeUndefined();   // not updated
  });

  it("upgrades geometry when new quality > existing (with fresh read)", async () => {
    const newGeoJson = { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [23.3, 42.7] as [number, number] }, properties: {} as Record<string, unknown> }] };
    mockFindEventById.mockResolvedValueOnce({ _id: "evt-1", geometryQuality: 2 });

    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "toplo-bg", geoJson: newGeoJson },
      { _id: "evt-1", geometryQuality: 2, sources: ["sofia-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    // First call: atomic update (no geometry)
    const atomicUpdate = mockUpdateEvent.mock.calls[0][1];
    expect(atomicUpdate.$inc).toEqual({ messageCount: 1 });
    // Second call: geometry upgrade after fresh read
    expect(mockFindEventById).toHaveBeenCalledWith("evt-1");
    const geometryUpdate = mockUpdateEvent.mock.calls[1][1];
    expect(geometryUpdate.$set.geoJson).toBe(newGeoJson);
    expect(geometryUpdate.$set.geometryQuality).toBe(3);
  });

  it("keeps existing geometry when existing quality >= new", async () => {
    const newGeoJson = { type: "FeatureCollection" as const, features: [] };
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg", geoJson: newGeoJson },
      { _id: "evt-1", geometryQuality: 3, sources: ["toplo-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    // Only one updateOne call (atomic ops), no geometry upgrade
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$set.geoJson).toBeUndefined();
    expect(update.$set.geometryQuality).toBeUndefined();
  });

  it("adds source atomically via $addToSet", async () => {
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg" },
      { _id: "evt-1", geometryQuality: 3, sources: ["toplo-bg"], messageCount: 1 },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    // $addToSet lets the DB handle deduplication
    expect(update.$addToSet.sources).toBe("sofia-bg");
  });

  it("merges categories atomically via $addToSet", async () => {
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg", categories: ["water", "traffic"] },
      {
        _id: "evt-1",
        geometryQuality: 3,
        sources: [],
        messageCount: 1,
        categories: ["water"],
      },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    // $addToSet lets the DB handle deduplication
    expect(update.$addToSet.categories).toEqual(["water", "traffic"]);
  });

  it("updates event embedding when new source has higher trust", async () => {
    const embedding = [0.1, 0.2, 0.3];
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "toplo-bg", embedding },
      {
        _id: "evt-1",
        geometryQuality: 2,
        sources: ["sofia-bg"],
        messageCount: 1,
        embedding: [0.4, 0.5, 0.6],
      },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$set.embedding).toEqual(embedding);
  });

  it("keeps event embedding when new source has lower trust", async () => {
    const embedding = [0.1, 0.2, 0.3];
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg", embedding },
      {
        _id: "evt-1",
        geometryQuality: 3,
        sources: ["toplo-bg"],
        messageCount: 1,
        embedding: [0.4, 0.5, 0.6],
      },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$set.embedding).toBeUndefined();
  });

  it("sets embedding when event has none", async () => {
    const embedding = [0.1, 0.2, 0.3];
    await attachMessageToEvent(
      mockDb,
      { _id: "msg-2", source: "sofia-bg", embedding },
      {
        _id: "evt-1",
        geometryQuality: 3,
        sources: ["toplo-bg"],
        messageCount: 1,
      },
      0.85,
      baseSignals,
    );

    const update = mockUpdateEvent.mock.calls[0][1];
    expect(update.$set.embedding).toEqual(embedding);
  });
});
