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

  it("uses lightweight navigation for the index page", async () => {
    const mockedCrawlWordpressPage = vi.mocked(crawlWordpressPage);
    mockedCrawlWordpressPage.mockResolvedValueOnce();

    await crawl();

    expect(mockedCrawlWordpressPage).toHaveBeenCalledTimes(1);

    const [options] = mockedCrawlWordpressPage.mock.calls[0];

    expect(options.indexUrl).toBe("https://vrabnitsa.sofia.bg/aktualno/news");
    expect(options.sourceType).toBe("vrabnitsa-org");
    expect(options.extractPostLinks).toBe(extractPostLinks);
    expect(options.waitUntil).toBe("domcontentloaded");
    expect(options.blockedResourceTypes).toEqual(["image", "media", "font"]);
  });

  it("uses lightweight navigation for post pages", async () => {
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

    expect(mockedProcessWordpressPost).toHaveBeenCalledWith(
      browser,
      postLink,
      db,
      "vrabnitsa-org",
      "bg.sofia",
      2000,
      extractPostDetails,
      expect.any(Function),
      "domcontentloaded",
      ["image", "media", "font"],
    );
  });
});