import { describe, it, expect, vi } from "vitest";
import { extractPostLinks, extractPostDetails } from "./extractors";

interface MockPage {
  evaluate: <T>(fn: (...args: any[]) => T, ...args: any[]) => Promise<T>;
}

function createMockPage(mockEvaluate: any): MockPage {
  return {
    evaluate: mockEvaluate,
  } as MockPage;
}

describe("rayon-ilinden-bg/extractors", () => {
  describe("extractPostLinks", () => {
    it("extracts post links from listing", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://ilinden.sofia.bg/%d0%b2%d1%80%d0%b5%d0%bc%d0%b5%d0%bd%d0%bd%d0%be-%d0%be%d0%b3%d1%80%d0%b0%d0%bd%d0%b8%d1%87%d0%b5%d0%bd%d0%b8%d0%b5-%d0%b7%d0%b0-%d0%bf%d0%b0%d1%80%d0%ba%d0%b8%d1%80%d0%b0%d0%bd%d0%b5-%d0%bd%d0%b0/",
          title: "Временно ограничение за паркиране",
          date: "22.12.2025",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(1);
      expect(posts[0].url).toContain("ilinden.sofia.bg");
      expect(posts[0].title).toBe("Временно ограничение за паркиране");
      expect(posts[0].date).toBe("22.12.2025");
    });

    it("filters out category links", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://ilinden.sofia.bg/category/%d1%81%d0%be%d1%84%d0%b8%d1%8f/",
          title: "София",
          date: "",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(0);
    });

    it("filters out pagination links", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://ilinden.sofia.bg/category/%d0%be%d0%b1%d1%89%d0%b8%d0%bd%d0%b0/page/2/",
          title: "Page 2",
          date: "",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(0);
    });

    it("handles mixed valid and invalid links", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://ilinden.sofia.bg/%d1%81%d1%8a%d0%be%d0%b1%d1%89%d0%b5%d0%bd%d0%b8%d0%b5-2/",
          title: "Съобщение",
          date: "04.08.2025",
        },
        {
          url: "https://ilinden.sofia.bg/tag/news/",
          title: "Tag",
          date: "",
        },
        {
          url: "https://ilinden.sofia.bg/%e2%9a%a0%ef%b8%8f-%d0%b2%d0%b0%d0%b6%d0%bd%d0%be-%d1%81%d1%8a%d0%be%d0%b1%d1%89%d0%b5%d0%bd%d0%b8%d0%b5-%d0%b2%d1%80%d0%b5%d0%bc%d0%b5%d0%bd%d0%bd%d0%be-%d0%bf%d1%80%d0%b5%d0%ba%d1%8a%d1%81%d0%b2/",
          title: "Важно съобщение",
          date: "26.09.2025",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(2);
      expect(posts.map((post) => post.title)).toEqual([
        "Съобщение",
        "Важно съобщение",
      ]);
    });
  });

  describe("extractPostDetails", () => {
    it("extracts details from post page", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title: "Временно ограничение за паркиране",
        dateText: "22.12.2025",
        contentHtml: "<p>Ремонтни дейности по ул. Мелник...</p>",
      });

      const page = createMockPage(mockEvaluate) as any;
      const details = await extractPostDetails(page);

      expect(details.title).toBe("Временно ограничение за паркиране");
      expect(details.dateText).toBe("22.12.2025");
      expect(details.contentHtml).toContain("Ремонтни дейности");
    });

    it("passes .related-posts to unwanted elements so related news are excluded", async () => {
      // Verify that extractPostDetails calls extractPostDetailsGeneric with .related-posts
      // in the unwanted elements list. We check this by ensuring the evaluate call receives
      // an array that includes ".related-posts".
      let capturedArgs: any;
      const mockEvaluate = vi.fn().mockImplementation((_fn: any, args: any) => {
        capturedArgs = args;
        return Promise.resolve({
          title: "Уведомления за дерегистрация по чл. 99б",
          dateText: "07.03.2026",
          contentHtml: "<p>Main content only</p>",
        });
      });

      const page = createMockPage(mockEvaluate) as any;
      await extractPostDetails(page);

      expect(capturedArgs?.unwantedElements).toContain(".related-posts");
    });
  });
});
