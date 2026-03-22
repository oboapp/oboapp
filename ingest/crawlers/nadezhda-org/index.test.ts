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

describe("nadezhda-org/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("configures crawlWordpressPage with nadezhda crawler settings", async () => {
    const mockedCrawlWordpressPage = vi.mocked(crawlWordpressPage);
    mockedCrawlWordpressPage.mockResolvedValueOnce();

    await crawl();

    expect(mockedCrawlWordpressPage).toHaveBeenCalledTimes(1);

    const [options] = mockedCrawlWordpressPage.mock.calls[0];

    expect(options.indexUrl).toBe(
      "https://nadezhda.sofia.bg/%D0%BE%D0%B1%D1%8F%D0%B2%D0%B8-%D0%B8-%D1%81%D1%8A%D0%BE%D0%B1%D1%89%D0%B5%D0%BD%D0%B8%D1%8F",
    );
    expect(options.sourceType).toBe("nadezhda-org");
    expect(options.delayBetweenRequests).toBe(2000);
    expect(options.extractPostLinks).toBe(extractPostLinks);
    expect(typeof options.processPost).toBe("function");
  });

  it("delegates per-post processing to processWordpressPost with expected parameters", async () => {
    const mockedCrawlWordpressPage = vi.mocked(crawlWordpressPage);
    const mockedProcessWordpressPost = vi.mocked(processWordpressPost);
    mockedCrawlWordpressPage.mockResolvedValueOnce();
    mockedProcessWordpressPost.mockResolvedValueOnce();

    await crawl();

    const [options] = mockedCrawlWordpressPage.mock.calls[0];

    const browser = {} as any;
    const db = {} as any;
    const postLink = {
      url: "https://nadezhda.sofia.bg/news/123/example",
      title: "Примерно съобщение",
      date: "",
    };

    await options.processPost(browser, postLink, db);

    expect(mockedProcessWordpressPost).toHaveBeenCalledTimes(1);
    expect(mockedProcessWordpressPost).toHaveBeenCalledWith(
      browser,
      postLink,
      db,
      "nadezhda-org",
      "bg.sofia",
      2000,
      extractPostDetails,
    );
  });

  it("propagates crawlWordpressPage errors", async () => {
    const mockedCrawlWordpressPage = vi.mocked(crawlWordpressPage);
    mockedCrawlWordpressPage.mockRejectedValueOnce(new Error("crawl failed"));

    await expect(crawl()).rejects.toThrow("crawl failed");
  });
});
