import { describe, it, expect, vi } from "vitest";
import {
  extractPostLinks,
  extractPostDetails,
  parseSerdikaDate,
} from "./extractors";

interface MockPage {
  evaluate: <T>(fn: (...args: any[]) => T, ...args: any[]) => Promise<T>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<void>;
}

function createMockPage(mockEvaluate: any): MockPage {
  return {
    evaluate: mockEvaluate,
    waitForSelector: vi.fn().mockResolvedValue(undefined),
  } as MockPage;
}

describe("serdika-egov-bg/extractors", () => {
  describe("extractPostLinks", () => {
    it("should extract post links from valid HTML", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/messages/mps202604",
          title:
            "Съобщение за поставени стикери-предписания за преместване на ИУМПС",
          date: "07 април 2026",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(1);
      expect(posts[0].url).toContain("serdika.egov.bg");
      expect(posts[0].url).toMatch(/\/actual\/messages\/mps202604$/);
      expect(posts[0].title).toContain("ИУМПС");
    });

    it("should filter out non-detail links (e.g. listing pages)", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/messages/mps202604",
          title: "Real article",
          date: "07 април 2026",
        },
        {
          url: "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/messages",
          title: "Listing page",
          date: "",
        },
        {
          url: "https://serdika.egov.bg/wps/portal/municipality-serdika/about",
          title: "About page",
          date: "",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(1);
      expect(posts[0].title).toBe("Real article");
    });

    it("should extract links across messages, news, and events", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([
        {
          url: "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/messages/msg1",
          title: "Message 1",
          date: "07 април 2026",
        },
        {
          url: "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/news/news1",
          title: "News 1",
          date: "08 април 2026",
        },
        {
          url: "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/events/event1",
          title: "Event 1",
          date: "20.04.2026 - 20.04.2026",
        },
      ]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toHaveLength(3);
    });

    it("should return empty array when no posts found", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue([]);

      const page = createMockPage(mockEvaluate) as any;
      const posts = await extractPostLinks(page);

      expect(posts).toEqual([]);
    });
  });

  describe("extractPostDetails", () => {
    it("should extract post details from valid HTML", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title:
          "Съобщение за поставени стикери-предписания за преместване на ИУМПС",
        dateText:
          "Дата на публикуване: 07.04.2026 Последна актуализация: 07.04.2026",
        contentHtml:
          "<p>В изпълнение на чл. 46 от Наредба за управление на отпадъците...</p>",
      });

      const page = createMockPage(mockEvaluate) as any;
      const details = await extractPostDetails(page);

      expect(details.title).toContain("ИУМПС");
      expect(details.dateText).toContain("07.04.2026");
      expect(details.contentHtml).toContain("отпадъците");
    });

    it("should handle missing elements gracefully", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title: "",
        dateText: "",
        contentHtml: "",
      });

      const page = createMockPage(mockEvaluate) as any;
      const details = await extractPostDetails(page);

      expect(details.title).toBe("");
      expect(details.dateText).toBe("");
      expect(details.contentHtml).toBe("");
    });
  });

  describe("parseSerdikaDate", () => {
    it("should prefer 'Дата на публикуване' date for events with multiple labels", () => {
      const text =
        "Дата на събитие: 20.04.2026 Дата на публикуване: 07.04.2026 Последна актуализация: 07.04.2026";
      const iso = parseSerdikaDate(text);
      expect(iso).toContain("2026-04-07");
    });

    it("should extract publish date from messages/news format", () => {
      const text =
        "Дата на публикуване: 08.04.2026 Последна актуализация: 08.04.2026";
      const iso = parseSerdikaDate(text);
      expect(iso).toContain("2026-04-08");
    });

    it("should fall back to the first DD.MM.YYYY when no publish label", () => {
      const text = "Some header 15.03.2026 footer";
      const iso = parseSerdikaDate(text);
      expect(iso).toContain("2026-03-15");
    });
  });
});
