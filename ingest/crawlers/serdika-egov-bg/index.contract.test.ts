import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { getDb } from "@/lib/db";
import { fetchPostLinksFromFeed, fetchPostDetailsFromHttp } from "./extractors";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("./extractors", async (original) => ({ ...await original<typeof import("./extractors")>(), fetchPostLinksFromFeed: vi.fn(), fetchPostDetailsFromHttp: vi.fn() }));
vi.mock("@/lib/delay", () => ({ delay: vi.fn().mockResolvedValue(undefined) }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const post = { url: "https://serdika.egov.bg/wps/portal/region-serdika/actual/actualmessages/repair", title: "Repair", date: "04.10.2026" };
let store: ReturnType<typeof createSourceStore>;
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate);
  store = createSourceStore(); vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(fetchPostLinksFromFeed).mockResolvedValue([post]);
  vi.mocked(fetchPostDetailsFromHttp).mockResolvedValue({ title: "Repair", dateText: "04.10.2026", contentHtml: "<p>Water repair</p>" });
});
afterEach(() => { vi.useRealTimers(); });

describe("Serdika crawl contract", () => {
  it("persists a detail once even when all three feeds discover it", async () => {
    await crawl(); await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    expect(fetchPostDetailsFromHttp).toHaveBeenCalledExactlyOnceWith(post.url);
    expect(vi.mocked(fetchPostLinksFromFeed).mock.calls.slice(0, 3)).toEqual([["actualmessages"], ["actualnews"], ["actualevents"]]);
    expect([...store.records.values()]).toEqual([expect.objectContaining({ url: post.url, title: "Repair", message: "Water repair", sourceType: "serdika-egov-bg", locality: "bg.sofia", processed: false, crawledAt: contractDate })]);
  });
  it("continues through a failed feed and a failed detail", async () => {
    vi.mocked(fetchPostLinksFromFeed).mockRejectedValueOnce(new Error("feed"));
    vi.mocked(fetchPostDetailsFromHttp).mockRejectedValueOnce(new Error("detail"));
    await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    expect(fetchPostLinksFromFeed).toHaveBeenCalledTimes(3);
  });
  it("does not fetch details for empty sections", async () => {
    vi.mocked(fetchPostLinksFromFeed).mockResolvedValue([]);
    await crawl(); expect(fetchPostDetailsFromHttp).not.toHaveBeenCalled();
  });
  it("propagates a lookup failure without fetching or overwriting that item", async () => {
    store.sources.findById.mockRejectedValueOnce(new Error("lookup"));
    await expect(crawl()).rejects.toThrow("lookup");
    expect(fetchPostDetailsFromHttp).not.toHaveBeenCalled(); expect(store.sources.setOne).not.toHaveBeenCalled();
  });
});
