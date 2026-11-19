import { describe, it, expect } from "vitest";
import { createSourceStore } from "@/__mocks__/source-contract";
import { encodeDocumentId, encodeDocumentIdForLookup, isUrlProcessed } from "./firestore";

describe("source persistence compatibility", () => {
  it("pins MD5 writes and legacy-first lookup without URL normalization", () => {
    expect(encodeDocumentIdForLookup("https://example.com")).toEqual([
      "aHR0cHM6Ly9leGFtcGxlLmNvbQ__", "c984d06aafbecf6bc55569f964148ea3",
    ]);
    for (const url of ["https://example.com/", "https://example.com/?a=1", "https://example.com/софия", "sensor-community://bg.sofia/cell/123"]) {
      expect(encodeDocumentId(url)).toMatch(/^[a-f0-9]{32}$/);
    }
    expect(encodeDocumentId("https://example.com/софия")).not.toBe(encodeDocumentId("https://example.com/%D1%81%D0%BE%D1%84%D0%B8%D1%8F"));
    expect(encodeDocumentId("https://example.com")).not.toBe(encodeDocumentId("https://example.com/"));
  });

  it("omits legacy IDs at the strict 1500 character boundary", () => {
    expect(encodeDocumentIdForLookup("a".repeat(1122))).toHaveLength(2);
    expect(encodeDocumentIdForLookup("a".repeat(1123))).toEqual([encodeDocumentId("a".repeat(1123))]);
  });

  it.each([
    ["https://example.com/софия", "a3508defaa11fd417d5d27087050c9c2"],
    ["https://example.com/%D1%81%D0%BE%D1%84%D0%B8%D1%8F", "9636994a7a51b222c008bbab101096d2"],
    ["https://example.com/?a=1", "632054a43843c47fe2178c21bb00e5bb"],
    ["sensor-community://bg.sofia/cell/123", "68a42c10efaf1349e098fa069cffb60c"],
  ])("preserves the historical MD5 for %s", (url, expected) => {
    expect(encodeDocumentId(url)).toBe(expected);
  });

  it.each([0, 1])("checks historical document IDs in legacy-first order (candidate %i)", async (candidate) => {
    const store = createSourceStore();
    const url = "https://example.com/item";
    const ids = encodeDocumentIdForLookup(url);
    store.records.set(ids[candidate], { url, processed: false });
    expect(await isUrlProcessed(url, store.db)).toBe(true);
    expect(store.sources.findById.mock.calls.map(([id]) => id)).toEqual(ids.slice(0, candidate + 1));
  });

  it("distinguishes an unknown identifier from a failed database read", async () => {
    const store = createSourceStore();
    const url = "https://example.com/new";
    expect(await isUrlProcessed(url, store.db)).toBe(false);
    store.sources.findById.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(isUrlProcessed(url, store.db)).rejects.toThrow("lookup failed");
  });
});
