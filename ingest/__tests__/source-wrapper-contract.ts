import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserMock, createSourceStore } from "@/__mocks__/source-contract";
import { crawlWordpressPage, processWordpressPost } from "@/crawlers/shared/webpage-crawlers";
import { crawlHybridRss, crawlFullRss } from "@/crawlers/shared/rss-crawler";

vi.mock("@/crawlers/shared/webpage-crawlers", () => ({ crawlWordpressPage: vi.fn(), processWordpressPost: vi.fn() }));
vi.mock("@/crawlers/shared/rss-crawler", () => ({ crawlHybridRss: vi.fn(), crawlFullRss: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

export function sourceWrapperContract(sourceType: string, url: string, mode: "webpage" | "hybrid" | "full", load: () => Promise<{ crawl: () => Promise<void> }>) {
  describe(`${sourceType} crawl contract`, () => {
    beforeEach(() => { vi.resetAllMocks(); });

    it("wires discovery, source identity, locality and detail processing", async () => {
      const { crawl } = await load();
      await crawl();
      if (mode === "full") {
        expect(crawlFullRss).toHaveBeenCalledExactlyOnceWith({ feedUrl: url, sourceType, locality: "bg.sofia", extractItems: expect.any(Function) });
        expect(processWordpressPost).not.toHaveBeenCalled();
        return;
      }
      const options = mode === "hybrid"
        ? vi.mocked(crawlHybridRss).mock.calls[0][0]
        : vi.mocked(crawlWordpressPage).mock.calls[0][0];
      expect(options).toMatchObject({ sourceType, [mode === "hybrid" ? "feedUrl" : "indexUrl"]: url });
      const { instance } = createBrowserMock();
      const { db } = createSourceStore();
      const item = { url: "https://example.com/exact%2Fitem?q=1", title: "Repair", date: "2026-10-04T09:00:00.000Z" };
      await options.processPost(instance, item, db);
      const args = vi.mocked(processWordpressPost).mock.calls[0];
      expect(args.slice(0, 6)).toEqual([instance, item, db, sourceType, "bg.sofia", 2000]);
      expect(args[6]).toBeTypeOf("function");
      if (mode === "hybrid") expect(args[7]?.(item.date)).toBe(item.date);
    });

    it("propagates orchestration failures to the runner", async () => {
      const helper = mode === "full" ? crawlFullRss : mode === "hybrid" ? crawlHybridRss : crawlWordpressPage;
      vi.mocked(helper).mockRejectedValueOnce(new Error("discovery failed"));
      const { crawl } = await load();
      await expect(crawl()).rejects.toThrow("discovery failed");
    });
  });
}
