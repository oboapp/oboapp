import { decode as decodeHtmlEntities } from "html-entities";

export const RSS_FEED_FETCH_TIMEOUT_MS = 30_000;

export interface RssFeedItem {
  url: string;
  title: string;
  date: string;
  contentHtml?: string;
}

export interface ParseRssFeedItemsOptions {
  hostname?: string;
  titleTag?: string;
  linkTag?: string;
  dateTag?: string;
  contentTag?: string;
  stripQuery?: boolean;
  contentTransform?: (contentHtml: string) => string;
}

function stripCdata(text: string): string {
  return text.replace(/^<!\[CDATA\[([\s\S]*?)]]>$/, "$1");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readTagValue(xml: string, tagName: string): string {
  const tagRe = new RegExp(
    String.raw`<${escapeRegExp(tagName)}>([\s\S]*?)<\/${escapeRegExp(tagName)}>`,
    "i",
  );
  const value = tagRe.exec(xml)?.[1]?.trim() ?? "";
  return decodeHtmlEntities(stripCdata(value));
}

function parseFeedItemUrl(
  url: string,
  options: Pick<ParseRssFeedItemsOptions, "hostname" | "stripQuery">,
): string | undefined {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return undefined;
  }

  if (options.hostname && parsedUrl.hostname !== options.hostname) {
    return undefined;
  }

  if (options.stripQuery) {
    parsedUrl.search = "";
    parsedUrl.hash = "";
  }

  return parsedUrl.toString();
}

/**
 * Remove the standard WordPress attribution paragraph from RSS descriptions.
 */
export function stripWordPressFeedAttribution(contentHtml: string): string {
  const marker = "публикуван за пръв път на";
  const lowerHtml = contentHtml.toLowerCase();
  const markerIndex = lowerHtml.lastIndexOf(marker);
  if (markerIndex === -1) {
    return contentHtml.trim();
  }

  const paragraphStart = lowerHtml.lastIndexOf("<p", markerIndex);
  const openingTagEnd =
    paragraphStart !== -1 ? lowerHtml.indexOf(">", paragraphStart) : -1;
  const removeStart =
    paragraphStart !== -1 && openingTagEnd !== -1
      ? paragraphStart
      : markerIndex;

  const paragraphEnd = lowerHtml.indexOf("</p>", markerIndex);
  const removeEnd = paragraphEnd === -1 ? contentHtml.length : paragraphEnd + 4;

  return (
    contentHtml.slice(0, removeStart) + contentHtml.slice(removeEnd)
  ).trim();
}

/**
 * Fetch RSS XML with a small timeout and a browser-like user agent.
 */
export async function fetchFeedXml(
  url: string,
  timeoutMs: number = RSS_FEED_FETCH_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; oboapp-crawler/1.0)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RSS feed returned ${response.status} for ${url}`);
    }

    const text = await response.text();
    if (text.includes("<rss") || text.includes("<channel>")) {
      return text;
    }
    throw new Error(
      `RSS feed response does not look like RSS (possible anti-bot or error page) for ${url}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse RSS feed XML into structured items.
 */
export function parseRssFeedItems(
  xml: string,
  options: ParseRssFeedItemsOptions = {},
): RssFeedItem[] {
  const titleTag = options.titleTag ?? "title";
  const linkTag = options.linkTag ?? "link";
  const dateTag = options.dateTag ?? "pubDate";
  const contentTag = options.contentTag;
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  const items: RssFeedItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = readTagValue(itemXml, titleTag);
    const url = parseFeedItemUrl(readTagValue(itemXml, linkTag), options);
    const dateText = readTagValue(itemXml, dateTag);

    if (!title || !url || !dateText) {
      continue;
    }

    const dateMs = Date.parse(dateText);
    if (Number.isNaN(dateMs)) {
      continue;
    }

    const contentValue = contentTag ? readTagValue(itemXml, contentTag) : "";
    const contentHtml = contentValue
      ? (options.contentTransform?.(contentValue) ?? contentValue)
      : undefined;

    items.push({
      url,
      title,
      date: new Date(dateMs).toISOString(),
      contentHtml,
    });
  }

  return items;
}

/**
 * Merge page-extracted post details with RSS feed metadata.
 * The RSS date is always used (ISO format, bypasses locale-specific parsers).
 * The extracted DOM title is preferred; falls back to the RSS title.
 */
export function mergePostDetails(
  extracted: { title: string; dateText: string; contentHtml: string },
  rss: Pick<RssFeedItem, "title" | "date">,
): { title: string; dateText: string; contentHtml: string } {
  return {
    ...extracted,
    dateText: rss.date,
    title: extracted.title || rss.title,
  };
}
