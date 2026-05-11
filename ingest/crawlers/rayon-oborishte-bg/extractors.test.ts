import { describe, expect, it } from "vitest";
import { extractFeedItems, mergePostDetails } from "./extractors";

function wrapInFeed(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>СО Оборище</title>
    ${items}
  </channel>
</rss>`;
}

function buildItemXml(
  title: string,
  url: string,
  date: string,
  description: string,
): string {
  return `<item>
      <title>${title}</title>
      <link>${url}</link>
      <pubDate>${date}</pubDate>
      <description><![CDATA[${description}]]></description>
    </item>`;
}

describe("rayon-oborishte-bg/extractors", () => {
  it("parses a valid RSS item into a feed entry", () => {
    const xml = wrapInFeed(
      buildItemXml(
        "Уведомление за ремонт",
        "https://rayon-oborishte.bg/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-test/",
        "Mon, 04 May 2026 08:11:59 +0000",
        "<p>Test content</p>",
      ),
    );

    const items = extractFeedItems(xml);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      url: "https://rayon-oborishte.bg/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-test/",
      title: "Уведомление за ремонт",
      date: "2026-05-04T08:11:59.000Z",
      contentHtml: "<p>Test content</p>",
    });
  });

  it("removes the standard WordPress attribution from the description", () => {
    const xml = wrapInFeed(
      buildItemXml(
        "Уведомление за предстоящи затваряния",
        "https://rayon-oborishte.bg/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-170/",
        "Wed, 29 Apr 2026 09:20:58 +0000",
        '<p>Първи параграф</p><p>Материалът <a href="https://rayon-oborishte.bg/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-170/">Уведомление</a> е публикуван за пръв път на <a href="https://rayon-oborishte.bg">СО Оборище</a>.</p>',
      ),
    );

    const items = extractFeedItems(xml);

    expect(items).toHaveLength(1);
    expect(items[0].contentHtml).toBe("<p>Първи параграф</p>");
  });

  it("skips items from other hosts", () => {
    const xml = wrapInFeed(
      buildItemXml(
        "External item",
        "https://example.com/post/1",
        "Mon, 04 May 2026 08:11:59 +0000",
        "<p>External</p>",
      ),
    );

    expect(extractFeedItems(xml)).toEqual([]);
  });

  it("skips items with invalid dates", () => {
    const xml = wrapInFeed(
      buildItemXml(
        "Broken date",
        "https://rayon-oborishte.bg/broken-date/",
        "not-a-date",
        "<p>Content</p>",
      ),
    );

    expect(extractFeedItems(xml)).toEqual([]);
  });

  it("keeps items without a description for discovery", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <item>
      <title>Уведомление без описание</title>
      <link>https://rayon-oborishte.bg/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-%d0%b1%d0%b5%d0%b7-%d0%be%d0%bf%d0%b8%d1%81%d0%b0%d0%bd%d0%b8%d0%b5/</link>
      <pubDate>Mon, 04 May 2026 08:11:59 +0000</pubDate>
    </item>
  </channel>
</rss>`;

    expect(extractFeedItems(xml)).toEqual([
      {
        url: "https://rayon-oborishte.bg/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-%d0%b1%d0%b5%d0%b7-%d0%be%d0%bf%d0%b8%d1%81%d0%b0%d0%bd%d0%b8%d0%b5/",
        title: "Уведомление без описание",
        date: "2026-05-04T08:11:59.000Z",
        contentHtml: undefined,
      },
    ]);
  });

  it("prefers RSS date and keeps extracted title when present", () => {
    const merged = mergePostDetails(
      {
        title: "Извлечено заглавие",
        dateText: "старо",
        contentHtml: "<p>Body</p>",
      },
      {
        title: "RSS заглавие",
        date: "2026-05-10T07:00:00.000Z",
      },
    );

    expect(merged).toEqual({
      title: "Извлечено заглавие",
      dateText: "2026-05-10T07:00:00.000Z",
      contentHtml: "<p>Body</p>",
    });
  });

  it("falls back to RSS title when extracted title is empty", () => {
    const merged = mergePostDetails(
      {
        title: "",
        dateText: "старо",
        contentHtml: "<p>Body</p>",
      },
      {
        title: "RSS заглавие",
        date: "2026-05-10T07:00:00.000Z",
      },
    );

    expect(merged.title).toBe("RSS заглавие");
    expect(merged.dateText).toBe("2026-05-10T07:00:00.000Z");
  });
});
