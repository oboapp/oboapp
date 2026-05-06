import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchFeedXml,
  parseFeedItems,
  extractPostDetails,
  FEED_FETCH_TIMEOUT_MS,
} from "./extractors";

// ---------------------------------------------------------------------------
// Helpers for building minimal RSS XML fixtures
// ---------------------------------------------------------------------------

function buildItemXml(title: string, url: string, date: string): string {
  return `<item>
      <title>${title}</title>
      <link>${url}</link>
      <description />
      <dc:date>${date}</dc:date>
    </item>`;
}

function wrapInChannel(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>Ремонти и промени в движението</title>
    <link>https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss</link>
    ${items}
  </channel>
</rss>`;
}

// Mock Page type from Playwright
interface MockPage {
  evaluate: <T>(
    fn: (...args: unknown[]) => T,
    ...args: unknown[]
  ) => Promise<T>;
}

function createMockPage(mockEvaluate: ReturnType<typeof vi.fn>): MockPage {
  return { evaluate: mockEvaluate } as MockPage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sofia-bg/extractors", () => {
  describe("fetchFeedXml", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should throw when response body does not look like RSS", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        text: async () => "<html><body>Access Denied</body></html>",
      } as Response);

      await expect(
        fetchFeedXml(
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss",
        ),
      ).rejects.toThrow("does not look like RSS");
    });

    it("should throw on non-2xx status", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      } as Response);

      await expect(
        fetchFeedXml(
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss",
        ),
      ).rejects.toThrow("403");
    });

    it("should propagate abort error on timeout", async () => {
      const abortError = new DOMException(
        "The operation was aborted.",
        "AbortError",
      );
      vi.mocked(fetch).mockRejectedValue(abortError);

      await expect(
        fetchFeedXml(
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss",
        ),
      ).rejects.toThrow("The operation was aborted.");
    });

    it("should abort the request after FEED_FETCH_TIMEOUT_MS via AbortController", async () => {
      vi.useFakeTimers();
      let capturedSignal: AbortSignal | undefined;

      vi.mocked(fetch).mockImplementation((_url, init) => {
        capturedSignal = (init as RequestInit).signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          capturedSignal!.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      });

      const promise = fetchFeedXml(
        "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss",
      );

      expect(capturedSignal?.aborted).toBe(false);
      vi.advanceTimersByTime(FEED_FETCH_TIMEOUT_MS);
      expect(capturedSignal?.aborted).toBe(true);

      await expect(promise).rejects.toThrow("The operation was aborted.");

      vi.useRealTimers();
    });

    it("should return XML when response is valid RSS", async () => {
      const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>`;
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        text: async () => rssXml,
      } as Response);

      const result = await fetchFeedXml(
        "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss",
      );
      expect(result).toBe(rssXml);
    });
  });

  describe("parseFeedItems", () => {
    it("should parse a single valid item", () => {
      const xml = wrapInChannel(
        buildItemXml(
          "Организация на движението",
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/12345",
          "2026-05-01T07:00:00Z",
        ),
      );

      const items = parseFeedItems(xml);

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Организация на движението");
      expect(items[0].url).toBe(
        "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/12345",
      );
      expect(items[0].date).toBe("2026-05-01T07:00:00.000Z");
    });

    it("should decode HTML entities in title", () => {
      const xml = wrapInChannel(
        buildItemXml(
          "Ремонт на бул. &quot;Витоша&quot; &amp; ул. &quot;Граф Игнатиев&quot;",
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/12345",
          "2026-05-01T07:00:00Z",
        ),
      );

      const items = parseFeedItems(xml);

      expect(items[0].title).toBe(
        'Ремонт на бул. "Витоша" & ул. "Граф Игнатиев"',
      );
    });

    it("should skip items missing dc:date", () => {
      const xml = wrapInChannel(`<item>
        <title>No Date Article</title>
        <link>https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/12345</link>
        <description />
      </item>`);

      const items = parseFeedItems(xml);

      expect(items).toHaveLength(0);
    });

    it("should parse multiple items in order", () => {
      const xml = wrapInChannel(
        buildItemXml(
          "Post 1",
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/1",
          "2026-05-01T07:00:00Z",
        ) +
          buildItemXml(
            "Post 2",
            "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/2",
            "2026-05-02T07:00:00Z",
          ) +
          buildItemXml(
            "Post 3",
            "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/3",
            "2026-05-03T07:00:00Z",
          ),
      );

      const items = parseFeedItems(xml);

      expect(items).toHaveLength(3);
      expect(items[0].title).toBe("Post 1");
      expect(items[1].title).toBe("Post 2");
      expect(items[2].title).toBe("Post 3");
    });

    it("should return empty array for empty XML", () => {
      expect(parseFeedItems("")).toEqual([]);
    });

    it("should parse items with CDATA-wrapped title and link", () => {
      const xml = wrapInChannel(`<item>
          <title><![CDATA[Ремонт на бул. "Витоша" & ул. "Граф Игнатиев"]]></title>
          <link><![CDATA[https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/12345]]></link>
          <description />
          <dc:date>2026-05-01T07:00:00Z</dc:date>
        </item>`);

      const items = parseFeedItems(xml);

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe(
        'Ремонт на бул. "Витоша" & ул. "Граф Игнатиев"',
      );
      expect(items[0].url).toBe(
        "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/12345",
      );
    });

    it("should skip items with a URL on a different host", () => {
      const xml = wrapInChannel(
        buildItemXml(
          "Malicious Item",
          "https://evil.example.com/steal",
          "2026-05-01T07:00:00Z",
        ),
      );
      expect(parseFeedItems(xml)).toHaveLength(0);
    });

    it("should skip items with an unparseable date", () => {
      const xml = wrapInChannel(
        buildItemXml(
          "Bad Date Item",
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/99",
          "not-a-date",
        ),
      );
      expect(parseFeedItems(xml)).toHaveLength(0);
    });

    it("should normalize timezone-offset dates to UTC ISO 8601", () => {
      const xml = wrapInChannel(
        buildItemXml(
          "Sofia Event",
          "https://www.sofia.bg/repairs-and-traffic-changes/-/asset_publisher/utdu/content/id/1",
          "2026-05-01T10:00:00+03:00",
        ),
      );
      const items = parseFeedItems(xml);
      expect(items).toHaveLength(1);
      expect(items[0].date).toBe("2026-05-01T07:00:00.000Z");
    });
  });

  describe("extractPostDetails", () => {
    it("should return title, empty dateText, and contentHtml", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title: "Временна организация на движението",
        dateText: "",
        contentHtml: "<div><p>Content paragraph</p></div>",
      });

      const page = createMockPage(mockEvaluate) as unknown as Parameters<
        typeof extractPostDetails
      >[0];
      const details = await extractPostDetails(page);

      expect(details.title).toBe("Временна организация на движението");
      expect(details.dateText).toBe("");
      expect(details.contentHtml).toBe("<div><p>Content paragraph</p></div>");
    });

    it("should return empty strings when page has no matching elements", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title: "",
        dateText: "",
        contentHtml: "",
      });

      const page = createMockPage(mockEvaluate) as unknown as Parameters<
        typeof extractPostDetails
      >[0];
      const details = await extractPostDetails(page);

      expect(details.title).toBe("");
      expect(details.dateText).toBe("");
      expect(details.contentHtml).toBe("");
    });

    it("should call page.evaluate once", async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        title: "Test Title",
        dateText: "",
        contentHtml: "<p>Content</p>",
      });

      const page = createMockPage(mockEvaluate) as unknown as Parameters<
        typeof extractPostDetails
      >[0];
      await extractPostDetails(page);

      expect(mockEvaluate).toHaveBeenCalledTimes(1);
    });
  });
});
