import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventFromMessage } from "./create-event";

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

const mockInsertEvent = vi.fn().mockResolvedValue("evt-new");
const mockInsertEventMessage = vi.fn().mockResolvedValue("em-new");
const mockCreateEventMessage = vi.fn().mockResolvedValue("msg-1");
const mockFindByMessageId = vi.fn().mockResolvedValue([]);
const mockDeleteEvent = vi.fn().mockResolvedValue(undefined);
const mockDb = {
  events: { insertOne: mockInsertEvent, deleteOne: mockDeleteEvent },
  eventMessages: {
    insertOne: mockInsertEventMessage,
    createOne: mockCreateEventMessage,
    findByMessageId: mockFindByMessageId,
  },
} as any;

describe("createEventFromMessage", () => {
  beforeEach(() => {
    mockInsertEvent.mockClear().mockResolvedValue("evt-new");
    mockInsertEventMessage.mockClear().mockResolvedValue("em-new");
    mockCreateEventMessage.mockClear().mockResolvedValue("msg-1");
    mockFindByMessageId.mockClear().mockResolvedValue([]);
    mockDeleteEvent.mockClear().mockResolvedValue(undefined);
  });

  it("creates event with correct fields from message", async () => {
    const result = await createEventFromMessage(mockDb, {
      _id: "msg-1",
      plainText: "Water outage on Vitosha blvd",
      markdownText: "**Water outage** on Vitosha blvd",
      geoJson: { type: "FeatureCollection", features: [] },
      timespanStart: "2025-03-01T08:00:00Z",
      timespanEnd: "2025-03-01T18:00:00Z",
      categories: ["water"],
      source: "sofia-bg",
      locality: "bg.sofia",
    });

    expect(result.eventId).toBe("evt-new");
    expect(result.confidence).toBe(1.0);
    expect(result.action).toBe("created");

    const eventData = mockInsertEvent.mock.calls[0][0];
    expect(eventData.plainText).toBe("Water outage on Vitosha blvd");
    expect(eventData.markdownText).toBe("**Water outage** on Vitosha blvd");
    expect(eventData.geometryQuality).toBe(2); // sofia-bg default
    expect(eventData.categories).toEqual(["water"]);
    expect(eventData.sources).toEqual(["sofia-bg"]);
    expect(eventData.messageCount).toBe(1);
    expect(eventData.confidence).toBe(1.0);
    expect(eventData.locality).toBe("bg.sofia");
  });

  it("creates EventMessage link with correct fields", async () => {
    await createEventFromMessage(mockDb, {
      _id: "msg-1",
      source: "toplo-bg",
      geoJson: { type: "FeatureCollection", features: [] },
    });

    const emData = mockCreateEventMessage.mock.calls[0][0];
    expect(emData.eventId).toBe("evt-new");
    expect(emData.messageId).toBe("msg-1");
    expect(emData.source).toBe("toplo-bg");
    expect(emData.confidence).toBe(1.0);
    expect(emData.geometryQuality).toBe(3); // toplo-bg = precomputed
    expect(emData.matchSignals).toBeNull(); // No matching process — new event
    expect(mockCreateEventMessage.mock.calls[0][1]).toBe("msg-1");
  });

  it("uses precomputed geometry quality for precomputed sources with geoJson", async () => {
    await createEventFromMessage(mockDb, {
      _id: "msg-1",
      source: "toplo-bg",
      geoJson: { type: "FeatureCollection", features: [] },
    });

    const eventData = mockInsertEvent.mock.calls[0][0];
    expect(eventData.geometryQuality).toBe(3);
  });

  it("sets geometry quality to 0 when no geoJson", async () => {
    await createEventFromMessage(mockDb, {
      _id: "msg-1",
      source: "toplo-bg",
    });

    const eventData = mockInsertEvent.mock.calls[0][0];
    expect(eventData.geometryQuality).toBe(0);
  });

  it("falls back to text when plainText is empty", async () => {
    await createEventFromMessage(mockDb, {
      _id: "msg-1",
      text: "fallback text",
      source: "sofia-bg",
    });

    const eventData = mockInsertEvent.mock.calls[0][0];
    expect(eventData.plainText).toBe("fallback text");
  });

  it("reuses existing event link for already-linked message", async () => {
    mockFindByMessageId.mockResolvedValueOnce([{ eventId: "evt-existing" }]);

    const result = await createEventFromMessage(mockDb, {
      _id: "msg-1",
      source: "sofia-bg",
      geoJson: { type: "FeatureCollection", features: [] },
    });

    expect(result).toEqual({ eventId: "evt-existing", confidence: 1.0, action: "attached" });
    expect(mockInsertEvent).not.toHaveBeenCalled();
    expect(mockInsertEventMessage).not.toHaveBeenCalled();
  });

  it("reuses concurrent link and cleans up orphan event on duplicate link create", async () => {
    const duplicate = new Error("Document already exists");
    (duplicate as { code?: unknown }).code = "already-exists";
    mockCreateEventMessage.mockRejectedValueOnce(duplicate);
    mockFindByMessageId
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ eventId: "evt-existing" }]);

    const result = await createEventFromMessage(mockDb, {
      _id: "msg-1",
      source: "sofia-bg",
      geoJson: { type: "FeatureCollection", features: [] },
    });

    expect(mockDeleteEvent).toHaveBeenCalledWith("evt-new");
    expect(result).toEqual({ eventId: "evt-existing", confidence: 1.0, action: "attached" });
  });
});
