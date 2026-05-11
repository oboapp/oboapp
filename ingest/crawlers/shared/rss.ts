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
    `<${escapeRegExp(tagName)}>([\\s\\S]*?)<\/${escapeRegExp(tagName)}>`,
    "i",
  );
  const value = tagRe.exec(xml)?.[1]?.trim() ?? "";
  return decodeHtmlEntities(stripCdata(value));
}

/**
 * Remove the standard WordPress attribution paragraph from RSS descriptions.
 */
export function stripWordPressFeedAttribution(contentHtml: string): string {
  return contentHtml
    .replace(
      /(?:\s*<p>)?\s*Материалът[\s\S]*?публикуван за пръв път на[\s\S]*?<\/p>\s*$/i,
      "",
    )
    .trim();
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
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RSS feed returned ${response.status} for ${url}`);
    }

    const text = await response.text();
    if (!text.includes("<rss") && !text.includes("<channel>")) {
      throw new Error(
        `RSS feed response does not look like RSS (possible anti-bot or error page) for ${url}`,
      );
    }

    return text;
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
    const url = readTagValue(itemXml, linkTag);
    const dateText = readTagValue(itemXml, dateTag);

    if (!title || !url || !dateText) {
      continue;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      continue;
    }

    if (options.hostname && parsedUrl.hostname !== options.hostname) {
      continue;
    }

    if (options.stripQuery) {
      parsedUrl.search = "";
      parsedUrl.hash = "";
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
      url: parsedUrl.toString(),
      title,
      date: new Date(dateMs).toISOString(),
      contentHtml,
    });
  }

  return items;
}