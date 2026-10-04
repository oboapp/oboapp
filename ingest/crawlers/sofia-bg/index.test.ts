import { beforeEach, describe, expect, it, vi } from "vitest";
import { crawl } from "./index";
import { fetchFeedXml, parseFeedItems, extractPostDetails } from "./extractors";
import { processWordpressPost } from "../shared/webpage-crawlers";
import { isUrlProcessed } from "../shared/firestore";
import type { Page } from "playwright";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), close: vi.fn(), launch: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ sources: { findMany: mocks.findMany } }) }));
vi.mock("./extractors", async (original) => ({ ...await original<typeof import("./extractors")>(), fetchFeedXml: vi.fn(), parseFeedItems: vi.fn(), extractPostDetails: vi.fn() }));
vi.mock("../shared/browser", () => ({ launchBrowser: mocks.launch }));
vi.mock("../shared/webpage-crawlers", () => ({ processWordpressPost: vi.fn() }));
vi.mock("../shared/firestore", () => ({ isUrlProcessed: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const post = { url: "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/123", title: "Ремонт на улица", date: "2026-10-02T00:00:00.000Z" };

describe("Sofia upstream RSS crawl contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.launch.mockResolvedValue({ close: mocks.close });
    vi.mocked(isUrlProcessed).mockResolvedValue(false);
    vi.mocked(fetchFeedXml).mockResolvedValue("feed");
    vi.mocked(parseFeedItems).mockReturnValue([post]);
  });

  it("preserves historical title fallback for records stored under legacy URLs", async () => {
    mocks.findMany.mockResolvedValue([{ title: post.title, url: "https://www.sofia.bg/w/old-article" }]);
    await crawl();
    expect(mocks.findMany).toHaveBeenCalledWith({ where: [{ field: "sourceType", op: "==", value: "sofia-bg" }], select: ["title"] });
    expect(processWordpressPost).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("skips known URLs without launching a browser", async () => {
    vi.mocked(isUrlProcessed).mockResolvedValue(true);
    await crawl();
    expect(isUrlProcessed).toHaveBeenCalledExactlyOnceWith(post.url, expect.anything());
    expect(processWordpressPost).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("deduplicates both feeds and preserves identity, locality and metadata fallback", async () => {
    vi.mocked(extractPostDetails).mockResolvedValue({ title: "", dateText: "", contentHtml: "<p>Repair</p>" });
    await crawl();
    expect(vi.mocked(fetchFeedXml).mock.calls).toEqual([
      ["https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss"],
      ["https://www.sofia.bg/news/-/asset_publisher/1ZlMReQfODHE/rss"],
    ]);
    expect(processWordpressPost).toHaveBeenCalledTimes(1);
    const args = vi.mocked(processWordpressPost).mock.calls[0];
    expect(args[1]).toEqual(post);
    expect(args.slice(3, 6)).toEqual(["sofia-bg", "bg.sofia", 2000]);
    expect(await args[6]({} as Page)).toEqual({ title: post.title, dateText: post.date, contentHtml: "<p>Repair</p>" });
    expect(args[7]?.(post.date)).toBe(post.date);
    expect(args[8]).toBe("domcontentloaded");
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("propagates a feed failure before fetching details", async () => {
    vi.mocked(fetchFeedXml).mockRejectedValueOnce(new Error("feed unavailable"));
    await expect(crawl()).rejects.toThrow("feed unavailable");
    expect(processWordpressPost).not.toHaveBeenCalled();
  });

  it("propagates historical-title query failures without detail writes", async () => {
    mocks.findMany.mockRejectedValueOnce(new Error("history unavailable"));
    await expect(crawl()).rejects.toThrow("history unavailable");
    expect(processWordpressPost).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("continues after a detail fails and closes the browser", async () => {
    vi.mocked(parseFeedItems).mockReturnValueOnce([post, { ...post, url: `${post.url}/second` }]).mockReturnValueOnce([]);
    vi.mocked(processWordpressPost).mockRejectedValueOnce(new Error("detail failed"));
    await crawl();
    expect(processWordpressPost).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("returns without a browser for empty feeds", async () => {
    vi.mocked(parseFeedItems).mockReturnValue([]);
    await crawl();
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(processWordpressPost).not.toHaveBeenCalled();
  });
});
