import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock firebase-admin to prevent initialization errors in tests
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {},
}));

const mockCreateOne = vi.fn();
const mockSourcesUpdateOne = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    messages: {
      createOne: (...args: unknown[]) => mockCreateOne(...args),
    },
    sources: {
      updateOne: (...args: unknown[]) => mockSourcesUpdateOne(...args),
    },
  }),
}));

vi.mock("@/lib/message-id-utils", () => ({
  generateMessageId: vi.fn(() => "MSGID123"),
}));

import { storeIncomingMessage } from "./store-incoming-message";

describe("storeIncomingMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOne.mockResolvedValue("MSGID123");
    mockSourcesUpdateOne.mockResolvedValue(undefined);
  });

  it("creates the message and marks the source processed when a sourceDocumentId is present", async () => {
    const id = await storeIncomingMessage(
      "text",
      "bg.sofia",
      "sofia-bg",
      "https://example.com/post-1",
      new Date("2026-06-06T00:00:00Z"),
      "SOURCEDOC1",
    );

    expect(id).toBe("MSGID123");
    expect(mockCreateOne).toHaveBeenCalledTimes(1);
    expect(mockCreateOne).toHaveBeenCalledWith(
      "MSGID123",
      expect.objectContaining({
        text: "text",
        locality: "bg.sofia",
        source: "sofia-bg",
        sourceDocumentId: "SOURCEDOC1",
      }),
    );
    expect(mockSourcesUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockSourcesUpdateOne).toHaveBeenCalledWith("SOURCEDOC1", {
      processed: true,
    });
  });

  it("does not touch the sources collection when no sourceDocumentId is provided", async () => {
    const id = await storeIncomingMessage("text", "bg.sofia", "sofia-bg");

    expect(id).toBe("MSGID123");
    expect(mockCreateOne).toHaveBeenCalledTimes(1);
    expect(mockSourcesUpdateOne).not.toHaveBeenCalled();
  });

  it("marks the source processed only after the message is created", async () => {
    const callOrder: string[] = [];
    mockCreateOne.mockImplementation(async () => {
      callOrder.push("createOne");
      return "MSGID123";
    });
    mockSourcesUpdateOne.mockImplementation(async () => {
      callOrder.push("updateOne");
    });

    await storeIncomingMessage(
      "text",
      "bg.sofia",
      "sofia-bg",
      undefined,
      undefined,
      "SOURCEDOC1",
    );

    expect(callOrder).toEqual(["createOne", "updateOne"]);
  });
});
