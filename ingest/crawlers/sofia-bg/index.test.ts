import { beforeEach, describe, expect, it, vi } from "vitest";
import { crawl } from "./index";
import { discoverPosts } from "./discovery";
import { processWordpressPost } from "../shared/webpage-crawlers";
import { isUrlProcessed } from "../shared/firestore";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  close: vi.fn(),
  launch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getDb: async () => ({ sources: { findMany: mocks.findMany } }),
}));
vi.mock("./discovery", () => ({
  discoverPosts: vi.fn(),
  discoverListingPosts: vi.fn(),
  NEWS_LISTING_URL: "https://www.sofia.bg/bg/news",
}));
vi.mock("../shared/browser", () => ({ launchBrowser: mocks.launch }));
vi.mock("../shared/webpage-crawlers", () => ({
  processWordpressPost: vi.fn(),
}));
vi.mock("../shared/firestore", () => ({ isUrlProcessed: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const post = {
  url: "https://www.sofia.bg/bg/web/guest/w/7983928",
  title: "Ремонт на улица",
  date: "2026-10-02T00:00:00.000Z",
};

describe("Sofia crawl deduplication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.launch.mockResolvedValue({ close: mocks.close });
    vi.mocked(isUrlProcessed).mockResolvedValue(false);
    vi.mocked(discoverPosts).mockResolvedValue({ posts: [post], errors: [] });
  });

  it.each([
    {
      title: " Ремонт\u00a0на\n улица ",
      url: "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/123",
    },
    { title: "Different old title", url: "https://www.sofia.bg/w/7983928" },
  ])("skips historical RSS titles or legacy URL aliases", async (stored) => {
    mocks.findMany.mockResolvedValue([stored]);
    await crawl();
    expect(processWordpressPost).not.toHaveBeenCalled();
  });

  it("does not write or reset a document if its URL lookup fails", async () => {
    vi.mocked(isUrlProcessed).mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(crawl()).rejects.toThrow("deduplication failed");
    expect(processWordpressPost).not.toHaveBeenCalled();
  });

  it("does not write duplicates discovered under different URL schemes in the same run", async () => {
    vi.mocked(discoverPosts).mockResolvedValue({
      posts: [
        post,
        { ...post, url: "https://www.sofia.bg/news/content/id/123" },
      ],
      errors: [],
    });
    await crawl();
    expect(processWordpressPost).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("processes available articles before surfacing the other source's failure", async () => {
    vi.mocked(discoverPosts).mockResolvedValue({
      posts: [post],
      errors: [new Error("repairs unavailable")],
    });
    await expect(crawl()).rejects.toThrow("discovery");
    expect(processWordpressPost).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
