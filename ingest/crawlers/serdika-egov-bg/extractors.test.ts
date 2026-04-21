import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchPostLinksFromFeed,
  extractPostDetails,
  parseSerdikaDate,
} from "./extractors";

// ---------------------------------------------------------------------------
// Helpers for building minimal ATOM feed responses
// ---------------------------------------------------------------------------
function atomFeed(entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
           xmlns:wplc="http://www.ibm.com/wplc/atom/1.0"
           xmlns:atom="http://www.w3.org/2005/Atom">
  <opensearch:totalResults exact="true">${entries ? "1" : "0"}</opensearch:totalResults>
  ${entries}
</atom:feed>`;
}

function atomEntry({
  title,
  contentPath,
  effectiveDateMs,
}: {
  title: string;
  contentPath: string;
  effectiveDateMs: number;
}): string {
  return `<atom:entry>
    <atom:title type="text/html">${title}</atom:title>
    <wplc:field id="contentpath">${contentPath}</wplc:field>
    <wplc:field id="effectivedate">${effectiveDateMs}</wplc:field>
  </atom:entry>`;
}

// ---------------------------------------------------------------------------
// Helper for mocking a Playwright Page
// ---------------------------------------------------------------------------
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
// ---------------------------------------------------------------------------
// fetchPostLinksFromFeed
// ---------------------------------------------------------------------------
describe("serdika-egov-bg/extractors", () => {
  describe("fetchPostLinksFromFeed", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function mockFetch(xml: string) {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(xml),
      });
    }

    it("parses title, URL, and date from a valid ATOM entry", async () => {
      // 2025-04-08T00:00:00Z = 1744070400000 ms
      const ts = 1744070400000;
      mockFetch(atomFeed(atomEntry({ title: "Съобщение за ИУМПС", contentPath: "/content/site/actual/messages/msg1", effectiveDateMs: ts })));

      const links = await fetchPostLinksFromFeed("actualmessages");
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe("https://serdika.egov.bg/wps/portal/municipality-serdika/actual/messages/msg1");
      expect(links[0].title).toBe("Съобщение за ИУМПС");
      expect(links[0].date).toBe("08.04.2025"); // UTC date for 1744070400000
    });

    it("decodes XML entities in titles", async () => {
      mockFetch(atomFeed(atomEntry({ title: "Район &quot;Сердика&quot; &amp; Новини", contentPath: "/content/site/actual/messages/x", effectiveDateMs: 1744070400000 })));

      const links = await fetchPostLinksFromFeed("actualmessages");
      expect(links[0].title).toBe('Район "Сердика" & Новини');
    });

    it("skips entries whose contentpath does not start with /content/site/", async () => {
      mockFetch(atomFeed(atomEntry({ title: "Skip me", contentPath: "/wrong/path/msg1", effectiveDateMs: 1744070400000 })));

      const links = await fetchPostLinksFromFeed("actualmessages");
      expect(links).toHaveLength(0);
    });

    it("returns empty array when the feed contains no entries", async () => {
      mockFetch(atomFeed(""));

      const links = await fetchPostLinksFromFeed("actualmessages");
      expect(links).toHaveLength(0);
    });

    it("throws when the feed returns a non-OK HTTP status", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503 });

      await expect(fetchPostLinksFromFeed("actualmessages")).rejects.toThrow("503");
    });

    it("builds correct canonical URLs for news and events sections", async () => {
      const ts = 1744070400000;
      const newsXml = atomFeed(atomEntry({ title: "News 1", contentPath: "/content/site/actual/news/news1", effectiveDateMs: ts }));
      mockFetch(newsXml);
      const newsLinks = await fetchPostLinksFromFeed("actualnews");
      expect(newsLinks[0].url).toBe("https://serdika.egov.bg/wps/portal/municipality-serdika/actual/news/news1");

      const eventsXml = atomFeed(atomEntry({ title: "Event 1", contentPath: "/content/site/actual/events/event1", effectiveDateMs: ts }));
      mockFetch(eventsXml);
      const eventLinks = await fetchPostLinksFromFeed("actualevents");
      expect(eventLinks[0].url).toBe("https://serdika.egov.bg/wps/portal/municipality-serdika/actual/events/event1");
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
