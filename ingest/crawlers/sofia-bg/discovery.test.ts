import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright";
import { discoverPosts, discoverListingPosts } from "./discovery";
import { extractListingPage, fetchFeedXml, parseFeedItems, REPAIRS_LISTING_URL } from "./extractors";

vi.mock("./extractors", () => ({
  REPAIRS_LISTING_URL: "https://www.sofia.bg/bg/repairs-and-traffic-changes",
  extractListingPage: vi.fn(), fetchFeedXml: vi.fn(), parseFeedItems: vi.fn(),
}));
vi.mock("@/lib/delay", () => ({ delay: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const news = { url: "https://www.sofia.bg/news/content/id/1", title: "News", date: "2026-10-02T00:00:00.000Z" };
const repairs = { ...news, url: "https://www.sofia.bg/w/2", title: "Repairs" };

describe("Sofia discovery", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still discovers news when repairs is unavailable and reports the failure", async () => {
    vi.mocked(fetchFeedXml).mockResolvedValue("news XML");
    vi.mocked(parseFeedItems).mockReturnValue([news]);
    const error = new Error("Repairs listing HTTP 403");
    const result = await discoverPosts(async () => { throw error; }, vi.fn());
    expect(result).toEqual({ posts: [news], errors: [error] });
    expect(fetchFeedXml).toHaveBeenCalledExactlyOnceWith("https://www.sofia.bg/news/-/asset_publisher/1ZlMReQfODHE/rss");
  });

  it("retains repairs when news fails", async () => {
    vi.mocked(fetchFeedXml).mockRejectedValue(new Error("news unavailable"));
    const result = await discoverPosts(async () => [repairs], async () => { throw new Error("listing unavailable"); });
    expect(result.posts).toEqual([repairs]);
    expect(result.errors).toHaveLength(1);
  });

  it("falls back to the news listing when RSS is unavailable", async () => {
    vi.mocked(fetchFeedXml).mockRejectedValue(new Error("HTTP 403"));
    const fallback = vi.fn().mockResolvedValue([news]);
    expect(await discoverPosts(async () => [repairs], fallback))
      .toEqual({ posts: [repairs, news], errors: [] });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("follows pagination until a fully known page and closes the page", async () => {
    const page = { goto: vi.fn().mockResolvedValue({ ok: () => true }), route: vi.fn(), close: vi.fn() };
    const browser = { newPage: vi.fn().mockResolvedValue(page) } as unknown as Browser;
    vi.mocked(extractListingPage)
      .mockResolvedValueOnce({ posts: [repairs], nextUrl: `${REPAIRS_LISTING_URL}?cur=2` })
      .mockResolvedValueOnce({ posts: [news], nextUrl: `${REPAIRS_LISTING_URL}?cur=3` });
    expect(await discoverListingPosts(browser, (post) => post.title === "News")).toEqual([repairs, news]);
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("rejects an inaccessible listing and closes the page", async () => {
    const page = { goto: vi.fn().mockResolvedValue({ ok: () => false, status: () => 403 }), route: vi.fn(), close: vi.fn() };
    await expect(discoverListingPosts({ newPage: async () => page } as unknown as Browser, () => false)).rejects.toThrow("HTTP 403");
    expect(extractListingPage).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledOnce();
  });
});
