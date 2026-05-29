import { beforeEach, describe, expect, it, vi } from "vitest";
import { crawl } from "./index";
import { extractPostDetails, extractPostLinks } from "./extractors";
import {
  crawlWordpressPage,
  processWordpressPost,
} from "../shared/webpage-crawlers";

vi.mock("./extractors", () => ({
  extractPostLinks: vi.fn(),
  extractPostDetails: vi.fn(),
}));

vi.mock("../shared/webpage-crawlers", () => ({
  crawlWordpressPage: vi.fn(),
  processWordpressPost: vi.fn(),
}));

describe("vrabnitsa-org/crawl config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses shared lightweight defaults for the index page", async () => {
    const mockedCrawlWordpressPage = vi.mocked(crawlWordpressPage);
    mockedCrawlWordpressPage.mockResolvedValueOnce();

    await crawl();

    expect(mockedCrawlWordpressPage).toHaveBeenCalledTimes(1);

    const [options] = mockedCrawlWordpressPage.mock.calls[0];

    expect(options.indexUrl).toBe("https://vrabnitsa.sofia.bg/aktualno/news");
    expect(options.sourceType).toBe("vrabnitsa-org");
    expect(options.extractPostLinks).toBe(extractPostLinks);
    expect(options.waitUntil).toBeUndefined();
    expect(options.blockedResourceTypes).toBeUndefined();
  });

  it("uses shared lightweight defaults for post pages", async () => {
    const mockedCrawlWordpressPage = vi.mocked(crawlWordpressPage);
    const mockedProcessWordpressPost = vi.mocked(processWordpressPost);
    mockedCrawlWordpressPage.mockResolvedValueOnce();
    mockedProcessWordpressPost.mockResolvedValueOnce();

    await crawl();

    const [options] = mockedCrawlWordpressPage.mock.calls[0];
    const browser = {} as never;
    const db = {} as never;
    const postLink = {
      url: "https://vrabnitsa.sofia.bg/aktualno/news/test-post",
      title: "Test post",
      date: "",
    };

    await options.processPost(browser, postLink, db);

    expect(mockedProcessWordpressPost).toHaveBeenCalledTimes(1);
    const call = mockedProcessWordpressPost.mock.calls[0];

    expect(call).toHaveLength(8);
    expect(call).toEqual([
      browser,
      postLink,
      db,
      "vrabnitsa-org",
      "bg.sofia",
      2000,
      extractPostDetails,
      expect.any(Function),
    ]);
  });
});
