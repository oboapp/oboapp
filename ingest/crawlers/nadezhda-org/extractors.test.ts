import { describe, expect, it, vi } from "vitest";
import { extractPostDetails, extractPostLinks } from "./extractors";

interface MockPage {
  evaluate: <T>(fn: (...args: any[]) => T, ...args: any[]) => Promise<T>;
}

function createMockPage(mockEvaluate: any): MockPage {
  return {
    evaluate: mockEvaluate,
  } as MockPage;
}

describe("nadezhda-org/extractors", () => {
  describe("extractPostLinks", () => {
    it("extracts and keeps only /news/ links", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://nadezhda.sofia.bg/news/2151/150/example",
          title: "График за СМР дейности",
          date: "",
        },
        {
          url: "https://nadezhda.sofia.bg/contacts",
          title: "Контакти",
          date: "",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(1);
      expect(posts[0].url).toContain("/news/");
      expect(posts[0].title).toBe("График за СМР дейности");
    });

    it("deduplicates by URL", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://nadezhda.sofia.bg/news/2151/150/example",
          title: "Първо заглавие",
          date: "",
        },
        {
          url: "https://nadezhda.sofia.bg/news/2151/150/example",
          title: "Второ заглавие",
          date: "",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(1);
      expect(posts[0].title).toBe("Второ заглавие");
    });

    it("returns empty array when no valid links exist", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://nadezhda.sofia.bg/contacts",
          title: "Контакти",
          date: "",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toEqual([]);
    });
  });

  describe("extractPostDetails", () => {
    it("extracts title, date, and content", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title: 'График за СМР дейности, ул. "Теодор Траянов" 2А',
        dateText: "16/03/2026",
        contentHtml: "<p>Текст на съобщението</p>",
      });

      const page = createMockPage(mockEvaluate) as any;
      const details = await extractPostDetails(page);

      expect(details.title).toContain("График за СМР дейности");
      expect(details.dateText).toBe("16/03/2026");
      expect(details.contentHtml).toContain("Текст на съобщението");
    });
  });
});
