import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delay } from "@/lib/delay";
import { fetchFeedXml, RssFeedHttpError } from "../shared/rss";
import { discoverItems, FEED_URLS } from "./discovery";
import { extractFeedItems } from "./extractors";

vi.mock("../shared/rss", async (original) => ({
  ...(await original<typeof import("../shared/rss")>()),
  fetchFeedXml: vi.fn(),
}));
vi.mock("@/lib/delay", () => ({ delay: vi.fn().mockResolvedValue(undefined) }));

const emptyFeed = "<rss><channel></channel></rss>";
const feed = (name: string, date = "2026-09-08T08:00:00Z") =>
  `<rss><channel><item><title>${name}</title><link>https://sredec-sofia.org/${name}/</link><pubDate>${date}</pubDate></item></channel></rss>`;
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures", name), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  vi.mocked(fetchFeedXml).mockReset().mockResolvedValue(emptyFeed);
});
afterEach(() => vi.useRealTimers());

describe("Sredets RSS discovery", () => {
  it("paginates all five categories and deduplicates cross-category URLs", async () => {
    vi.mocked(fetchFeedXml).mockImplementation(async (url) => {
      const parsed = new URL(url);
      const category = decodeURIComponent(parsed.pathname);
      if (category.includes("saobshtenia")) {
        return parsed.search ? emptyFeed : feed("graffiti");
      }
      if (!category.includes("новини")) {
        return emptyFeed;
      }
      if (parsed.searchParams.get("paged") === "3") {
        return emptyFeed;
      }
      return parsed.search ? feed("graffiti") : feed("washing");
    });
    const result = await discoverItems();
    expect(result.map((item) => item.title)).toEqual(["washing", "graffiti"]);
    expect(result[1]).toMatchObject({
      url: "https://sredec-sofia.org/graffiti/",
      date: "2026-09-08T08:00:00.000Z",
    });
    for (const url of FEED_URLS) {
      expect(fetchFeedXml).toHaveBeenCalledWith(new URL(url).toString());
    }
    expect(fetchFeedXml).toHaveBeenCalledTimes(8);
    expect(delay).toHaveBeenCalledTimes(8);
    expect(delay).toHaveBeenCalledWith(2000);
  });

  it("stops at the exact ingestion age cutoff, preserving newer posts on the same page", async () => {
    vi.mocked(fetchFeedXml).mockResolvedValueOnce(
      feed("recent", "2026-07-28T00:00:01Z").replace(
        "</channel>",
        "<item><title>old</title><link>https://sredec-sofia.org/old/</link><pubDate>2026-07-28T00:00:00Z</pubDate></item></channel>",
      ),
    );
    expect((await discoverItems()).map((item) => item.title)).toEqual([
      "recent",
    ]);
    expect(fetchFeedXml).toHaveBeenCalledTimes(5);
  });

  it("treats a later-page 404 as the end of a feed", async () => {
    vi.mocked(fetchFeedXml)
      .mockResolvedValueOnce(feed("notice"))
      .mockRejectedValueOnce(new RssFeedHttpError(404, "page2"));
    expect(await discoverItems()).toHaveLength(1);
    expect(fetchFeedXml).toHaveBeenCalledTimes(6);
  });

  it.each([404, 403, 500])("fails on first-page HTTP %s", async (status) => {
    vi.mocked(fetchFeedXml).mockRejectedValueOnce(
      new RssFeedHttpError(status, "feed"),
    );
    await expect(discoverItems()).rejects.toThrow(
      `RSS feed returned ${status}`,
    );
  });

  it("propagates later-page server failures", async () => {
    vi.mocked(fetchFeedXml)
      .mockResolvedValueOnce(feed("notice"))
      .mockRejectedValueOnce(new RssFeedHttpError(500, "page2"));
    await expect(discoverItems()).rejects.toThrow("RSS feed returned 500");
  });

  it("rejects repeated pages instead of looping", async () => {
    vi.mocked(fetchFeedXml).mockResolvedValue(feed("notice"));
    await expect(discoverItems()).rejects.toThrow("repeated a page");
    expect(fetchFeedXml).toHaveBeenCalledTimes(2);
  });

  it("fails visibly at the pagination safety limit", async () => {
    vi.mocked(fetchFeedXml).mockImplementation(async (url) =>
      feed(`post-${new URL(url).searchParams.get("paged") ?? "1"}`),
    );
    await expect(discoverItems()).rejects.toThrow("exceeded 100 pages");
    expect(fetchFeedXml).toHaveBeenCalledTimes(100);
  });

  it("reads live category fixtures and leaves administrative relevance to ingestion", async () => {
    const files = [
      "useful.xml",
      "news.xml",
      "announcements.xml",
      "investment.xml",
      "discussion.xml",
    ];
    vi.mocked(fetchFeedXml).mockImplementation(async (url) => {
      const index = FEED_URLS.findIndex(
        (candidate) => new URL(candidate).pathname === new URL(url).pathname,
      );
      return new URL(url).search ? emptyFeed : fixture(files[index]);
    });
    const result = await discoverItems();
    expect(result).toHaveLength(2);
    expect(result[0].title).toContain("ЕКОКЛАС");
    expect(result[1].title).toContain("военни оркестранти");
    expect(extractFeedItems(fixture("useful.xml"))[0]).toMatchObject({
      title: "Започва поетапно машинно миене на улици и тротоари в „Средец“",
      date: "2025-07-14T18:44:21.000Z",
      contentHtml: undefined,
    });
  });

  it("discovers the real graffiti notice behind the first announcements page", async () => {
    vi.mocked(fetchFeedXml).mockImplementation(async (url) => {
      const parsed = new URL(url);
      if (!parsed.pathname.includes("saobshtenia")) {
        return emptyFeed;
      }
      const page = parsed.searchParams.get("paged");
      if (page === "3") {
        return emptyFeed;
      }
      return fixture(page ? "graffiti.xml" : "announcements.xml");
    });
    const result = await discoverItems();
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      title: "Уведомление относно почистване на графити",
      date: "2026-09-08T12:39:00.000Z",
    });
    expect(result[1].url).toBe(
      extractFeedItems(fixture("graffiti.xml"))[0].url,
    );
  });
});
