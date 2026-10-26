import { delay } from "@/lib/delay";
import { logger } from "@/lib/logger";
import {
  fetchFeedXml,
  RssFeedHttpError,
  type RssFeedItem,
} from "../shared/rss";
import { extractFeedItems } from "./extractors";

// Verified on 2026-10-26: category RSS feeds contain one excerpt per page.
export const FEED_URLS = [
  "публикации/полезна-информация",
  "новини",
  "публикации/saobshtenia",
  "публикации/инвестиционни-намерения",
  "обществениобсъждания",
].map((category) => `https://sredec-sofia.org/category/${category}/feed/`);

const MAX_PAGES_PER_FEED = 100;
const REQUEST_DELAY_MS = 2000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

async function readPage(url: string, page: number): Promise<RssFeedItem[]> {
  try {
    return extractFeedItems(await fetchFeedXml(url));
  } catch (error) {
    // WordPress returns 404 after the final page. A missing first page is a failure.
    if (page > 1 && error instanceof RssFeedHttpError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

async function discoverFeed(
  feedUrl: string,
  cutoff: number,
): Promise<RssFeedItem[]> {
  const found = new Map<string, RssFeedItem>();
  for (let page = 1; page <= MAX_PAGES_PER_FEED; page++) {
    await delay(REQUEST_DELAY_MS);
    const url = new URL(feedUrl);
    if (page > 1) {
      url.searchParams.set("paged", String(page));
    }
    const items = await readPage(url.toString(), page);
    if (items.length === 0) {
      return [...found.values()];
    }

    const recent = items.filter((item) => Date.parse(item.date) > cutoff);
    const newItems = recent.filter((item) => !found.has(item.url));
    for (const item of newItems) {
      found.set(item.url, item);
    }
    // Category feeds are newest first. Stop before collecting stale history.
    if (recent.length < items.length) {
      return [...found.values()];
    }
    if (newItems.length === 0) {
      throw new Error(`RSS pagination repeated a page for ${feedUrl}`);
    }
  }
  // Fail visibly if the safety bound would silently omit eligible posts.
  throw new Error(
    `RSS pagination exceeded ${MAX_PAGES_PER_FEED} pages for ${feedUrl}`,
  );
}

export async function discoverItems(): Promise<RssFeedItem[]> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const cutoff = midnight.getTime() - MAX_AGE_MS;
  const found = new Map<string, RssFeedItem>();
  for (const feedUrl of FEED_URLS) {
    const items = await discoverFeed(feedUrl, cutoff);
    for (const item of items) {
      if (!found.has(item.url)) {
        found.set(item.url, item);
      }
    }
  }
  logger.debug("Discovered recent Sredets posts", {
    sourceType: "sredec-sofia-org",
    feeds: FEED_URLS.length,
    count: found.size,
  });
  return [...found.values()];
}
