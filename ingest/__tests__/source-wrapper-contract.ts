import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import type { PostLink } from "@/crawlers/shared/types";
import type { RssFeedItem } from "@/crawlers/shared/rss";
import { contractDate, createBrowserMock, createSourceStore } from "@/__mocks__/source-contract";
import { crawlWordpressPage, processWordpressPost } from "@/crawlers/shared/webpage-crawlers";
import { crawlHybridRss, crawlFullRss } from "@/crawlers/shared/rss-crawler";

vi.mock("@/crawlers/shared/webpage-crawlers", () => ({ crawlWordpressPage: vi.fn(), processWordpressPost: vi.fn() }));
vi.mock("@/crawlers/shared/rss-crawler", () => ({ crawlHybridRss: vi.fn(), crawlFullRss: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

interface Extractors {
  extractPostLinks?: (page: Page) => Promise<PostLink[]>;
  extractPostDetails?: (page: Page) => Promise<{ title: string; dateText: string; contentHtml: string }>;
  extractFeedItems?: (xml: string) => RssFeedItem[];
}

function expectedDateCase(source: string) {
  // These expectations deliberately do not call the source's production parser.
  const localMidnight = new Date(2026, 9, 4).toISOString();
  const cases: Record<string, { input: string; expected: string }> = {
    "mladost-bg": { input: "4 октомври 2026", expected: localMidnight },
    "sdvr-mvr-bg": { input: "4 октомври 2026", expected: localMidnight },
    "krasna-polyana-org": { input: "2026-10-04T10:00:00+03:00", expected: "2026-10-04T07:00:00.000Z" },
    "vrabnitsa-org": { input: "Публикувано: 4 октомври 2026", expected: localMidnight },
    "rayon-pancharevo-bg": { input: "4-6.10.2026", expected: localMidnight },
    "inspectorat-so-org": { input: "", expected: "2026-10-03T22:00:00.000Z" },
  };
  return cases[source];
}

export function sourceWrapperContract(sourceType: string, url: string, mode: "webpage" | "hybrid" | "full", load: () => Promise<{ crawl: () => Promise<void> }>, loadExtractors: () => Promise<Extractors>) {
  describe(`${sourceType} crawl contract`, () => {
    beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate); });
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    it("wires discovery, source identity, locality and detail processing", async () => {
      const { crawl } = await load();
      const extractors = await loadExtractors();
      const item = { url: "https://example.com/exact%2Fitem?q=1", title: "Repair", date: mode === "hybrid" ? "2026-10-04T09:00:00.000Z" : "04.10.2026" };
      const discovery = extractors.extractPostLinks
        ? vi.spyOn(extractors, "extractPostLinks").mockResolvedValue([item])
        : undefined;
      await crawl();
      if (mode === "full") {
        expect(crawlFullRss).toHaveBeenCalledExactlyOnceWith({ feedUrl: url, sourceType, locality: "bg.sofia", extractItems: expect.any(Function) });
        expect(processWordpressPost).not.toHaveBeenCalled();
        expect(vi.mocked(crawlFullRss).mock.calls[0][0].extractItems).toBe(extractors.extractFeedItems);
        return;
      }
      const options = mode === "hybrid"
        ? vi.mocked(crawlHybridRss).mock.calls[0][0]
        : vi.mocked(crawlWordpressPage).mock.calls[0][0];
      expect(options).toMatchObject({ sourceType, [mode === "hybrid" ? "feedUrl" : "indexUrl"]: url });
      const { instance, pageInstance } = createBrowserMock();
      const { db } = createSourceStore();
      if ("extractPostLinks" in options) {
        expect(await options.extractPostLinks(pageInstance)).toEqual([item]);
        expect(discovery).toHaveBeenCalledWith(pageInstance);
      } else {
        expect(options.extractItems).toBe(extractors.extractFeedItems);
      }
      await options.processPost(instance, item, db);
      const args = vi.mocked(processWordpressPost).mock.calls[0];
      expect(args.slice(0, 6)).toEqual([instance, item, db, sourceType, "bg.sofia", 2000]);
      if (mode === "hybrid") {
        const detail = vi.spyOn(extractors, "extractPostDetails").mockResolvedValue({ title: "", dateText: "stale date", contentHtml: "<p>Details</p>" });
        expect(await args[6](pageInstance)).toEqual({ title: "Repair", dateText: item.date, contentHtml: "<p>Details</p>" });
        expect(detail).toHaveBeenCalledWith(pageInstance);
        expect(args[7]?.(item.date)).toBe(item.date);
      } else {
        expect(args[6]).toBe(extractors.extractPostDetails);
        const dateCase = expectedDateCase(sourceType);
        if (dateCase) {
          expect(args[7], "custom date parser must be wired into detail processing").toBeTypeOf("function");
          expect(args[7]?.(dateCase.input)).toBe(dateCase.expected);
        } else {
          expect(args[7]).toBeUndefined();
        }
      }
    });

    it("propagates orchestration failures to the runner", async () => {
      const helper = mode === "full" ? crawlFullRss : mode === "hybrid" ? crawlHybridRss : crawlWordpressPage;
      vi.mocked(helper).mockRejectedValueOnce(new Error("discovery failed"));
      const { crawl } = await load();
      await expect(crawl()).rejects.toThrow("discovery failed");
    });
  });
}
