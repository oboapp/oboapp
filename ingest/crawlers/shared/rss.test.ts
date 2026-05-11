import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFeedXml,
  parseRssFeedItems,
  stripWordPressFeedAttribution,
} from "./rss";

describe("shared/rss", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses items and decodes entities/CDATA", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Tom &amp; Jerry]]></title>
      <link>https://example.com/post-1</link>
      <pubDate>Mon, 04 May 2026 08:11:59 +0000</pubDate>
      <description><![CDATA[<p>Body &amp; details</p>]]></description>
    </item>
  </channel>
</rss>`;

    expect(parseRssFeedItems(xml, { contentTag: "description" })).toEqual([
      {
        url: "https://example.com/post-1",
        title: "Tom & Jerry",
        date: "2026-05-04T08:11:59.000Z",
        contentHtml: "<p>Body & details</p>",
      },
    ]);
  });

  it("filters by hostname and strips query/hash when configured", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Keep me</title>
      <link>https://www.sofia.bg/repairs?id=1#section</link>
      <pubDate>Mon, 04 May 2026 08:11:59 +0000</pubDate>
    </item>
    <item>
      <title>Drop me</title>
      <link>https://example.com/post-2</link>
      <pubDate>Mon, 04 May 2026 08:11:59 +0000</pubDate>
    </item>
  </channel>
</rss>`;

    expect(
      parseRssFeedItems(xml, {
        hostname: "www.sofia.bg",
        stripQuery: true,
      }),
    ).toEqual([
      {
        url: "https://www.sofia.bg/repairs",
        title: "Keep me",
        date: "2026-05-04T08:11:59.000Z",
        contentHtml: undefined,
      },
    ]);
  });

  it("strips WordPress feed attribution from the description", () => {
    const html =
      "<p>Първи параграф</p><p>Материалът <a href=\"https://rayon-oborishte.bg/test\">Тест</a> е публикуван за пръв път на <a href=\"https://rayon-oborishte.bg\">СО Оборище</a>.</p>";

    expect(stripWordPressFeedAttribution(html)).toBe("<p>Първи параграф</p>");
  });

  it("fetches and returns RSS xml", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<rss><channel></channel></rss>",
      } as Response);

    const xml = await fetchFeedXml("https://example.com/feed");

    expect(xml).toContain("<rss>");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/feed",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "Mozilla/5.0 (compatible; oboapp-crawler/1.0)",
        }),
      }),
    );
  });

  it("throws when response is not RSS-like", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      {
        ok: true,
        status: 200,
        text: async () => "<html><body>Blocked</body></html>",
      } as Response,
    );

    await expect(fetchFeedXml("https://example.com/feed")).rejects.toThrow(
      "RSS feed response does not look like RSS",
    );
  });
});
