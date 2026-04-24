import { describe, it, expect, vi } from "vitest";
import { extractPostLinks, extractPostDetails } from "./extractors";

function createMockPage(mockEvaluate: ReturnType<typeof vi.fn>) {
  return { evaluate: mockEvaluate } as unknown as import("playwright").Page;
}

describe("sdvr-mvr-bg/extractors", () => {
  describe("extractPostLinks", () => {
    it("should extract article links with valid numeric IDs", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8/90155",
          title: "СДВР с акция срещу пътния травматизъм в София",
          date: "21 Април 2026",
        },
      ]);

      const page = createMockPage(mockEvaluate);
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(1);
      expect(posts[0].title).toBe("СДВР с акция срещу пътния травматизъм в София");
      expect(posts[0].date).toBe("21 Април 2026");
    });

    it("should filter out category/tag links and keep only article links", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        // tag link — must be excluded
        {
          url: "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8?tag=1",
          title: "Новини",
          date: "",
        },
        // article link — must be included
        {
          url: "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8/90207",
          title: "Полицаи от СДВР обучаваха деца на безопасно поведение на пътя",
          date: "23 Април 2026",
        },
      ]);

      const page = createMockPage(mockEvaluate);
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(1);
      expect(posts[0].title).toBe(
        "Полицаи от СДВР обучаваха деца на безопасно поведение на пътя",
      );
    });

    it("should return empty array when no posts found", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([]);

      const page = createMockPage(mockEvaluate);
      const posts = await extractPostLinks(page);

      expect(posts).toEqual([]);
    });

    it("should filter out links without a numeric article ID", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        // navigation link — no numeric ID at end
        {
          url: "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80",
          title: "Пресцентър",
          date: "",
        },
      ]);

      const page = createMockPage(mockEvaluate);
      const posts = await extractPostLinks(page);

      expect(posts).toEqual([]);
    });
  });

  describe("extractPostDetails", () => {
    it("should extract title, date, and content from article page", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title: "СДВР с акция срещу пътния травматизъм в София",
        dateText: "21 Април 2026",
        contentHtml:
          "<p>Денонощната полицейска операция се проведе от 6 до 17 април.</p>",
      });

      const page = createMockPage(mockEvaluate);
      const details = await extractPostDetails(page);

      expect(details.title).toBe(
        "СДВР с акция срещу пътния травматизъм в София",
      );
      expect(details.dateText).toBe("21 Април 2026");
      expect(details.contentHtml).toContain("Денонощната полицейска операция");
    });
  });
});
