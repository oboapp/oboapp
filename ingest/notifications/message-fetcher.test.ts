import { describe, it, expect } from "vitest";

import { isMessageStale } from "./message-fetcher";

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
