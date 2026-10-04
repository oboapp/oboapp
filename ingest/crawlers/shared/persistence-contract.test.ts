import { describe, it, expect } from "vitest";
import { createSourceStore, rawSource } from "@/__mocks__/source-contract";
import { encodeDocumentId, encodeDocumentIdForLookup, isUrlProcessed, saveSourceDocument, saveSourceDocumentIfNew } from "./firestore";

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

  it.each([0, 1])("preserves historical records found by lookup candidate %i", async (candidate) => {
    const { db, sources, records } = createSourceStore();
    const doc = rawSource();
    const ids = encodeDocumentIdForLookup(doc.url);
    records.set(ids[candidate], { ...doc, processed: true });
    expect(await saveSourceDocumentIfNew({ ...doc, message: "Changed upstream" }, db)).toBe(false);
    expect(sources.findById.mock.calls.map(([id]) => id)).toEqual(ids.slice(0, candidate + 1));
    expect(sources.setOne).not.toHaveBeenCalled();
    expect(records.get(ids[candidate])).toEqual({ ...doc, processed: true });
  });

  it("saves once and treats an unprocessed record as already known", async () => {
    const { db, sources, records } = createSourceStore();
    const doc = rawSource();
    expect(await saveSourceDocumentIfNew(doc, db)).toBe(true);
    expect(await saveSourceDocumentIfNew({ ...doc, message: "Updated", datePublished: "2026-10-05" }, db)).toBe(false);
    expect(sources.setOne).toHaveBeenCalledTimes(1);
    expect(records.get(encodeDocumentId(doc.url))).toEqual({ ...doc, processed: false });
  });

  it("does not write when lookup fails", async () => {
    const { db, sources } = createSourceStore();
    sources.findById.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(saveSourceDocumentIfNew(rawSource(), db)).rejects.toThrow("lookup failed");
    expect(sources.setOne).not.toHaveBeenCalled();
  });

  it("reports missing URLs and propagates write failures", async () => {
    const { db, sources } = createSourceStore();
    expect(await isUrlProcessed("https://example.com/new", db)).toBe(false);
    sources.setOne.mockRejectedValueOnce(new Error("write failed"));
    await expect(saveSourceDocumentIfNew(rawSource(), db)).rejects.toThrow("write failed");
  });

  it.each([{ categories: [" heating ", " water "] }, { categories: '[" heating "," water "]' }, { categories: " heating, water " }])("normalizes categories $categories", async ({ categories }) => {
    const { db, sources } = createSourceStore();
    await saveSourceDocument(rawSource({ categories }), db);
    expect(sources.setOne).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ categories: ["heating", "water"], processed: false }));
  });

  it("validates locality before persistence", async () => {
    const { db, sources } = createSourceStore();
    await expect(saveSourceDocument(rawSource({ locality: "invalid" }), db)).rejects.toThrow();
    expect(sources.setOne).not.toHaveBeenCalled();
  });

  it("retains transform output, explicit processing state, and optional handoff fields", async () => {
    const { db, sources } = createSourceStore();
    const doc = rawSource({ categories: [" weather "], processed: true, deepLinkUrl: "", cityWide: true, markdownText: "**Warning**", isRelevant: true });
    await saveSourceDocument(doc, db, { transformData: (value) => ({ ...value, geoJson: '{"type":"FeatureCollection","features":[]}' }) });
    expect(sources.setOne).toHaveBeenCalledWith(encodeDocumentId(doc.url), {
      ...doc, categories: ["weather"], geoJson: '{"type":"FeatureCollection","features":[]}',
    });
  });
});
