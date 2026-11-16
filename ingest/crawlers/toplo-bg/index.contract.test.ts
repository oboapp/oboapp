// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { toploHtml, pointGeometry } from "@/__mocks__/source-contract-fixtures";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const identifier = "https://toplo.bg/incidents/item-1";
const documentId = "cbf67133fb60fcb862ec54ff677afd05";
let store: ReturnType<typeof createSourceStore>;
let fetchListing: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  vi.mocked(getDb).mockResolvedValue(store.db);
  fetchListing = vi.fn<typeof globalThis.fetch>(async () => {
    return new Response(toploHtml());
  });
  vi.stubGlobal("fetch", fetchListing);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Toplo packaged crawl contract", () => {
  it("refreshes incident estimates on every crawl while retaining the first source record", async () => {
    await crawl();
    const historical = store.records.get(documentId);
    vi.setSystemTime(new Date(contractDate.getTime() + 30 * 60 * 1000));
    fetchListing.mockResolvedValue(new Response(toploHtml().replace(
      '"UntilDate":null',
      '"UntilDate":"2026-11-15T20:00:00Z"',
    )));

    await crawl();

    expect(store.records.get(documentId)).toBe(historical);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.snapshots[0].incidents?.[0].estimatedEnd).toBeNull();
    expect(store.snapshots[1].incidents?.[0]).toMatchObject({
      id: "item-1",
      type: "repair",
      estimatedEnd: "2026-11-15T20:00:00Z",
    });
    expect(store.snapshots[1].observedAt).not.toBe(store.snapshots[0].observedAt);
  });
  it("persists the historical raw fields once and fetches only the listing", async () => {
    await crawl();
    await crawl();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.get(documentId)).toMatchObject({
      url: identifier,
      deepLinkUrl: "",
      sourceType: "toplo-bg",
      locality: "bg.sofia",
      title: "Ремонт",
      message: expect.stringContaining("ул. Тест"),
      markdownText: expect.stringContaining("Ремонт"),
      geoJson: JSON.stringify(pointGeometry),
      categories: ["heating"],
      isRelevant: true,
      processed: false,
      crawledAt: contractDate,
      datePublished: "2026-10-04T08:00:00.000Z",
      timespanStart: new Date("2026-10-04T08:00:00.000Z"),
      timespanEnd: new Date("2026-10-04T08:00:00.000Z"),
    });
    expect(fetchListing).toHaveBeenCalledTimes(2);
    expect(store.snapshots).toMatchObject([
      {
        sourceType: "toplo-bg",
        locality: "bg.sofia",
        count: 1,
        observedAt: contractDate.toISOString(),
      },
      {
        sourceType: "toplo-bg",
        locality: "bg.sofia",
        count: 1,
        observedAt: contractDate.toISOString(),
      },
    ]);
    for (const [url, options] of fetchListing.mock.calls) {
      expect(url).toBe("https://toplo.bg/accidents-and-maintenance");
      expect(options?.signal?.aborted).toBe(true);
    }
  });

  it("dry run counts discovered incidents without initializing or querying persistence", async () => {
    fetchListing.mockImplementation(async () => {
      return new Response(toploHtml(["item-1", "item-2"]));
    });
    store.records.set(documentId, { url: identifier, processed: true });

    await crawl(true);

    expect(getDb).not.toHaveBeenCalled();
    expect(store.sources.findById).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sourceSnapshots.save).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Crawl complete", expect.objectContaining({
      sourceType: "toplo-bg",
      saved: 2,
      skipped: 0,
      failed: 0,
    }));
    expect(fetchListing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("continues after a write failure and retries only the missing incident next scan", async () => {
    fetchListing.mockImplementation(async () => {
      return new Response(toploHtml(["item-1", "item-2"]));
    });
    store.client.createOne.mockRejectedValueOnce(new Error("Storage unavailable"));

    await crawl();
    expect([...store.records.values()]).toEqual([
      expect.objectContaining({ url: "https://toplo.bg/incidents/item-2" }),
    ]);
    await crawl();

    expect(store.records.size).toBe(2);
    expect(store.client.createOne).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 1,
      skipped: 1,
      failed: 0,
    }));
  });

  it("continues after a lookup failure without fetching or overwriting its historical record", async () => {
    fetchListing.mockImplementation(async () => {
      return new Response(toploHtml(["item-1", "item-2"]));
    });
    const historical = { url: identifier, title: "Historical content", processed: true };
    store.records.set(documentId, historical);
    store.sources.findById.mockRejectedValueOnce(new Error("Lookup unavailable"));

    await crawl();

    expect(store.records.get(documentId)).toBe(historical);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.client.createOne).toHaveBeenCalledWith(
      "sources",
      expect.objectContaining({ url: "https://toplo.bg/incidents/item-2" }),
      "88df5870f23267ba483802452310c670",
    );
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 1,
      skipped: 0,
      failed: 1,
    }));
  });

  it("rejects an unrecognized listing and closes its source", async () => {
    fetchListing.mockResolvedValue(new Response("<html></html>"));

    await expect(crawl()).rejects.toThrow("complete incident listing");

    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sourceSnapshots.save).not.toHaveBeenCalled();
    expect(fetchListing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("rejects a completely failed scan and closes its source", async () => {
    store.client.createOne.mockRejectedValue(new Error("Storage unavailable"));

    await expect(crawl()).rejects.toThrow("All incidents failed to process");

    expect(store.records.size).toBe(0);
    expect(fetchListing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("propagates an HTTP failure and closes its source", async () => {
    fetchListing.mockResolvedValue(new Response("Unavailable", { status: 503 }));

    await expect(crawl()).rejects.toThrow("HTTP 503");

    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(fetchListing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("preserves an invalid publication date while falling back timespans to crawl time", async () => {
    fetchListing.mockResolvedValue(new Response(toploHtml(["item-1"], "invalid")));

    await crawl();

    expect(store.records.get(documentId)).toMatchObject({
      datePublished: "invalid",
      timespanStart: contractDate,
      timespanEnd: contractDate,
    });
  });

  it("preserves an empty provider name", async () => {
    fetchListing.mockResolvedValue(new Response(toploHtml().replace('"Name":"Ремонт"', '"Name":""')));

    await crawl();

    expect(store.records.get(documentId)).toMatchObject({
      title: "",
      message: expect.stringContaining("ул. Тест"),
      markdownText: expect.stringContaining("ул. Тест"),
    });
  });

  it("records a lower count when an incident disappears without changing source history", async () => {
    fetchListing.mockImplementationOnce(async () => {
      return new Response(toploHtml(["item-1", "item-2"]));
    });
    await crawl();
    const nextCrawl = new Date(contractDate.getTime() + 30 * 60 * 1000);
    vi.setSystemTime(nextCrawl);
    await crawl();

    expect(store.snapshots).toMatchObject([
      {
        sourceType: "toplo-bg",
        locality: "bg.sofia",
        count: 2,
        observedAt: contractDate.toISOString(),
      },
      {
        sourceType: "toplo-bg",
        locality: "bg.sofia",
        count: 1,
        observedAt: nextCrawl.toISOString(),
      },
    ]);
    expect(store.records.size).toBe(2);
    expect(fetchListing).toHaveBeenCalledTimes(2);
  });

  it("records a verified zero and closes the source without message writes", async () => {
    fetchListing.mockResolvedValue(new Response(toploHtml([])));

    await crawl();

    expect(store.snapshots).toMatchObject([
      {
        sourceType: "toplo-bg",
        locality: "bg.sofia",
        count: 0,
        observedAt: contractDate.toISOString(),
      },
    ]);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(fetchListing).toHaveBeenCalledOnce();
    expect(store.snapshots[0].incidents).toEqual([]);
    expect(fetchListing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("counts invalid map data before the package filters it", async () => {
    const html = toploHtml(["item-1", "item-2"]).replace(
      JSON.stringify(pointGeometry.features),
      "[invalid json",
    );
    fetchListing.mockResolvedValue(new Response(html));

    await crawl();

    expect(store.snapshots[0].count).toBe(2);
    expect(store.records.size).toBe(1);
    expect(store.records.has(documentId)).toBe(false);
    expect(fetchListing).toHaveBeenCalledOnce();
    expect(store.sourceSnapshots.save.mock.invocationCallOrder[0]).toBeLessThan(
      store.sources.findById.mock.invocationCallOrder[0],
    );
  });

  it("keeps a valid snapshot when every map incident is unusable", async () => {
    const html = toploHtml().replace(JSON.stringify(pointGeometry.features), "[invalid json");
    fetchListing.mockResolvedValue(new Response(html));

    await expect(crawl()).rejects.toThrow("No incidents found in HTML");

    expect(store.snapshots[0].count).toBe(1);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(fetchListing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("preserves the last observation when the visible list and metadata disagree", async () => {
    await crawl();
    fetchListing.mockResolvedValue(new Response(toploHtml().replace(
      'data-accidentId="item-1"',
      'data-accidentId="unexpected"',
    )));

    await expect(crawl()).rejects.toThrow("does not match");

    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0].observedAt).toBe(contractDate.toISOString());
  });

  it("closes the package and stops before item persistence when saving a snapshot fails", async () => {
    store.sourceSnapshots.save.mockRejectedValueOnce(new Error("Snapshot storage unavailable"));

    await expect(crawl()).rejects.toThrow("Snapshot storage unavailable");

    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.findById).not.toHaveBeenCalled();
    expect(fetchListing.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
