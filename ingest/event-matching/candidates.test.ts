import { describe, it, expect, vi, beforeEach } from "vitest";
import { findCandidateEvents } from "./candidates";
import { CANDIDATE_TIME_WINDOW_DAYS } from "./constants";

const mockFindCandidates = vi.fn().mockResolvedValue([]);
const mockDb = {
  events: { findCandidates: mockFindCandidates },
} as any;

describe("findCandidateEvents", () => {
  beforeEach(() => {
    mockFindCandidates.mockClear();
  });

  it("queries with time window expanded by CANDIDATE_TIME_WINDOW_DAYS", async () => {
    await findCandidateEvents(mockDb, {
      locality: "bg.sofia",
      timespanStart: "2025-03-03T08:00:00Z",
      timespanEnd: "2025-03-03T18:00:00Z",
    });

    expect(mockFindCandidates).toHaveBeenCalledTimes(1);
    const [locality, start, end, options] = mockFindCandidates.mock.calls[0];
    expect(locality).toBe("bg.sofia");

    const windowMs = CANDIDATE_TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    expect(start.getTime()).toBe(
      new Date("2025-03-03T08:00:00Z").getTime() - windowMs,
    );
    expect(end.getTime()).toBe(
      new Date("2025-03-03T18:00:00Z").getTime() + windowMs,
    );
    expect(options).toEqual({ cityWideOnly: false });
  });

  it("city-wide messages query with cityWideOnly: true", async () => {
    await findCandidateEvents(mockDb, {
      locality: "bg.sofia",
      timespanStart: "2025-03-03T08:00:00Z",
      timespanEnd: "2025-03-03T18:00:00Z",
      cityWide: true,
    });

    const [, , , options] = mockFindCandidates.mock.calls[0];
    expect(options).toEqual({ cityWideOnly: true });
  });

  it("uses current time when timespans are missing", async () => {
    const before = Date.now();
    await findCandidateEvents(mockDb, { locality: "bg.sofia" });
    const after = Date.now();

    const [, start, end] = mockFindCandidates.mock.calls[0];
    const windowMs = CANDIDATE_TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    // start should be roughly now - window
    expect(start.getTime()).toBeGreaterThanOrEqual(before - windowMs - 100);
    expect(start.getTime()).toBeLessThanOrEqual(after - windowMs + 100);
    // end should be roughly now + window
    expect(end.getTime()).toBeGreaterThanOrEqual(before + windowMs - 100);
    expect(end.getTime()).toBeLessThanOrEqual(after + windowMs + 100);
  });

  it("returns candidates from db", async () => {
    const candidate = { _id: "evt-1", geometry: null };
    mockFindCandidates.mockResolvedValueOnce([candidate]);

    const result = await findCandidateEvents(mockDb, {
      locality: "bg.sofia",
      timespanStart: "2025-03-03T08:00:00Z",
      timespanEnd: "2025-03-03T18:00:00Z",
    });
    expect(result).toEqual([candidate]);
  });
});
