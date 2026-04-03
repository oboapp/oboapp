import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "@/lib/types";

// Must mock firebase-admin before any module that transitively imports it
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: vi.fn(),
}));

const mockUpdateMessage = vi.fn();
vi.mock("./db/update-message", () => ({
  updateMessage: (...args: unknown[]) => mockUpdateMessage(...args),
}));

const mockFindById = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    messages: {
      findById: (...args: unknown[]) => mockFindById(...args),
    },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createGeocodingProgressTracker } from "./geocoding-progress-tracker";

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

type ProcessStep = Record<string, unknown>;
type UpdateOp =
  | { $addToSet: { process: ProcessStep } }
  | { $set: { process: ProcessStep[] } };

/** All calls to updateMessage as typed tuples. */
function updateCalls(): Array<[string, UpdateOp]> {
  return mockUpdateMessage.mock.calls as Array<[string, UpdateOp]>;
}

/** Calls that wrote a geocodingBatch step ($addToSet). */
function batchWrites() {
  return updateCalls()
    .filter(
      (c): c is [string, { $addToSet: { process: ProcessStep } }] =>
        "$addToSet" in c[1],
    )
    .map(([, u]) => u.$addToSet.process);
}

/** Calls that wrote a final geocoding step ($set). */
function finalWrites() {
  return updateCalls()
    .filter(
      (c): c is [string, { $set: { process: ProcessStep[] } }] =>
        "$set" in c[1],
    )
    .map(([, u]) => u.$set.process);
}

function makeAddress(text: string): Address {
  return {
    originalText: text,
    formattedAddress: `${text}, Sofia`,
    coordinates: { lat: 42.7, lng: 23.3 },
    geoJson: { type: "Point", coordinates: [23.3, 42.7] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMessage.mockResolvedValue(undefined);
});

describe("createGeocodingProgressTracker", () => {
  describe("recordPins batching", () => {
    it("does not flush when pending count is below BATCH_SIZE", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 20);
      // 9 pins — below the 10-item threshold
      await tracker.recordPins(
        Array.from({ length: 9 }, (_, i) => makeAddress(`Addr ${i}`)),
        9,
      );
      expect(mockUpdateMessage).not.toHaveBeenCalled();
    });

    it("flushes exactly when pending count reaches BATCH_SIZE", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 20);
      // 10 pins — meets threshold inside the loop
      await tracker.recordPins(
        Array.from({ length: 10 }, (_, i) => makeAddress(`Addr ${i}`)),
        10,
      );
      expect(batchWrites()).toHaveLength(1);
      expect(batchWrites()[0]["pins"]).toHaveLength(10);
      expect(batchWrites()[0]["step"]).toBe("geocodingBatch");
    });

    it("flushes multiple times when more than BATCH_SIZE pins are added", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 25);
      await tracker.recordPins(
        Array.from({ length: 22 }, (_, i) => makeAddress(`Addr ${i}`)),
        22,
      );
      // Should flush at 10 and again at 20; 2 remaining stay pending
      expect(batchWrites()).toHaveLength(2);
    });
  });

  describe("recordStreet batching", () => {
    it("flushes after 10 mixed pins+streets", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 20);
      await tracker.recordPins(
        Array.from({ length: 8 }, (_, i) => makeAddress(`Addr ${i}`)),
        8,
      );
      expect(batchWrites()).toHaveLength(0);

      // Adding 2 streets should push past BATCH_SIZE
      await tracker.recordStreet({
        key: "street-1",
        originalName: "Main St",
        geometry: '{"type":"Feature"}',
      });
      await tracker.recordStreet({
        key: "street-2",
        originalName: "Side St",
        geometry: '{"type":"Feature"}',
      });

      expect(batchWrites()).toHaveLength(1);
    });
  });

  describe("flush failure recovery", () => {
    it("retains pending items when the DB write fails so they can be flushed later", async () => {
      mockUpdateMessage.mockRejectedValueOnce(new Error("network error"));

      const tracker = createGeocodingProgressTracker("msg1", 20);
      const pins = Array.from({ length: 10 }, (_, i) =>
        makeAddress(`Addr ${i}`),
      );

      await expect(tracker.recordPins(pins, 10)).rejects.toThrow(
        "network error",
      );

      // After failure, fix the mock and finalize — the failed items should still appear
      mockFindById.mockResolvedValue({ process: [] });
      mockUpdateMessage.mockResolvedValue(undefined);

      await tracker.finalize();

      const writes = finalWrites();
      expect(writes).toHaveLength(1);
      const geocodingStep = writes[0].find((s) => s["step"] === "geocoding");
      expect(geocodingStep?.["pins"]).toHaveLength(10);
    });
  });

  describe("finalize()", () => {
    it("replaces geocodingBatch entries for the run with a single geocoding step", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 5);

      mockFindById.mockResolvedValue({
        process: [
          { step: "filterAndSplit" },
          { step: "geocodingBatch", runId: "other-run", pins: [], streets: [] },
        ],
      });

      await tracker.recordPins([makeAddress("Addr 1")], 1);
      await tracker.finalize();

      const writes = finalWrites();
      expect(writes).toHaveLength(1);
      const process = writes[0];
      expect(
        process.filter((s) => s["step"] === "filterAndSplit"),
      ).toHaveLength(1);
      expect(
        process.filter(
          (s) => s["step"] === "geocodingBatch" && s["runId"] === "other-run",
        ),
      ).toHaveLength(1);
      expect(process.filter((s) => s["step"] === "geocoding")).toHaveLength(1);
    });

    it("does not write a geocoding step when no pins or streets were resolved", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 3);
      tracker.recordAttempted(3);
      await tracker.finalize();

      expect(mockFindById).not.toHaveBeenCalled();
      expect(finalWrites()).toHaveLength(0);
    });

    it("flushes any remaining pending items before finalizing", async () => {
      mockFindById.mockResolvedValue({ process: [] });

      const tracker = createGeocodingProgressTracker("msg1", 5);
      // 3 pins — below flush threshold, should be captured by finalize's final flush
      await tracker.recordPins(
        [makeAddress("A"), makeAddress("B"), makeAddress("C")],
        3,
      );
      expect(batchWrites()).toHaveLength(0);

      await tracker.finalize();

      const writes = finalWrites();
      expect(writes).toHaveLength(1);
      const geocodingStep = writes[0].find((s) => s["step"] === "geocoding");
      expect(geocodingStep?.["pins"]).toHaveLength(3);
    });

    it("strips own geocodingBatch entries and keeps unrelated process steps", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 12);

      // Flush 10 items to get a geocodingBatch entry committed
      await tracker.recordPins(
        Array.from({ length: 10 }, (_, i) => makeAddress(`Addr ${i}`)),
        10,
      );
      expect(batchWrites()).toHaveLength(1);
      const runId = batchWrites()[0]["runId"] as string;

      // Simulate DB state: the batch entry plus unrelated steps
      mockFindById.mockResolvedValue({
        process: [
          { step: "categorize" },
          { step: "geocodingBatch", runId, pins: [], streets: [] },
        ],
      });

      await tracker.recordPins(
        [makeAddress("Addr 10"), makeAddress("Addr 11")],
        2,
      );
      await tracker.finalize();

      const writes = finalWrites();
      const steps = writes[0].map((s) => s["step"]);
      expect(steps).toContain("categorize");
      expect(steps).not.toContain("geocodingBatch");
      expect(steps).toContain("geocoding");
    });
  });

  describe("flushPending()", () => {
    it("flushes pending items to geocodingBatch without writing a geocoding step", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 5);
      await tracker.recordPins(
        [makeAddress("A"), makeAddress("B"), makeAddress("C")],
        3,
      );
      // Below BATCH_SIZE — no auto-flush yet
      expect(batchWrites()).toHaveLength(0);

      await tracker.flushPending();

      expect(batchWrites()).toHaveLength(1);
      expect(batchWrites()[0]["step"]).toBe("geocodingBatch");
      expect(batchWrites()[0]["pins"]).toHaveLength(3);
      // No consolidation — findById and $set must not have been called
      expect(mockFindById).not.toHaveBeenCalled();
      expect(finalWrites()).toHaveLength(0);
    });

    it("is a no-op when there are no pending items", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 5);
      await tracker.flushPending();
      expect(mockUpdateMessage).not.toHaveBeenCalled();
    });

    it("does not flush already-flushed items again", async () => {
      const tracker = createGeocodingProgressTracker("msg1", 15);
      // Trigger an auto-flush at BATCH_SIZE
      await tracker.recordPins(
        Array.from({ length: 10 }, (_, i) => makeAddress(`Addr ${i}`)),
        10,
      );
      expect(batchWrites()).toHaveLength(1);

      // flushPending should only flush the remaining 0 pending items (none left)
      await tracker.flushPending();
      expect(batchWrites()).toHaveLength(1);
    });
  });

  describe("progress tracking", () => {
    it("accumulates done count across recordPins, recordStreet, and recordAttempted", async () => {
      mockFindById.mockResolvedValue({ process: [] });
      const tracker = createGeocodingProgressTracker("msg1", 10);

      await tracker.recordPins([makeAddress("A"), makeAddress("B")], 3); // done += 3
      await tracker.recordStreet({
        key: "s1",
        originalName: "Main St",
        geometry: "{}",
      }); // done += 1
      tracker.recordAttempted(4); // done += 4
      await tracker.finalize();

      const writes = finalWrites();
      const geocodingStep = writes[0].find((s) => s["step"] === "geocoding");
      const progress = geocodingStep?.["progress"] as {
        done: number;
        toDo: number;
      };
      expect(progress.done).toBe(8);
      expect(progress.toDo).toBe(10);
    });
  });
});
