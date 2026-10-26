import type { Browser } from "playwright";
import type { OboDb } from "@oboapp/db";
import type { RssFeedItem } from "./rss";
import { fetchFeedXml } from "./rss";
import { buildWebPageSourceDocument } from "./webpage-crawlers";
import { isUrlProcessed, saveSourceDocument } from "./firestore";
import { launchBrowser } from "./browser";
import { logger } from "@/lib/logger";

export interface CrawlFullRssOptions {
  feedUrl: string;
  sourceType: string;
  locality: string;
  extractItems: (xml: string) => RssFeedItem[];
}

export interface CrawlHybridRssOptions {
  feedUrl: string;
  sourceType: string;
  extractItems: (xml: string) => RssFeedItem[];
  discoverItems?: () => Promise<RssFeedItem[]>;
  processPost: (
    browser: Browser,
    item: RssFeedItem,
    db: OboDb,
  ) => Promise<void>;
}

/**
 * Crawl a WordPress RSS feed that includes full post content in `content:encoded`
 * or `description` — no browser needed. Each item is stored directly from the feed.
 */
export async function crawlFullRss({
  feedUrl,
  sourceType,
  locality,
  extractItems,
}: CrawlFullRssOptions): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  logger.info("Starting crawler", { sourceType });

  let feedItems: RssFeedItem[];
  try {
    const xml = await fetchFeedXml(feedUrl);
    feedItems = extractItems(xml);
  } catch (error) {
    logger.error("Failed to fetch or parse RSS feed", {
      sourceType,
      feedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (feedItems.length === 0) {
    logger.warn("No posts found in RSS feed", { sourceType });
    return;
  }

  const uniqueItems = deduplicate(feedItems);

  logger.debug("Fetched RSS feed", {
    sourceType,
    feedUrl,
    count: uniqueItems.length,
  });

  const newItems = await filterUnprocessed(uniqueItems, db, sourceType);
  const skipped = uniqueItems.length - newItems.length;

  if (newItems.length === 0) {
    logger.info("Crawl complete", {
      sourceType,
      total: uniqueItems.length,
      saved: 0,
      skipped,
      failed: 0,
    });
    return;
  }

  let saved = 0;
  let failed = 0;

  for (const item of newItems) {
    try {
      const doc = buildWebPageSourceDocument({
        url: item.url,
        title: item.title,
        dateText: item.date,
        contentHtml: item.contentHtml ?? "",
        sourceType,
        locality,
        customDateParser: (d) => d,
      });
      await saveSourceDocument({ ...doc, crawledAt: new Date() }, db);
      saved++;
    } catch (error) {
      failed++;
      logger.debug("Post processing failed", {
        sourceType,
        url: item.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("Crawl complete", {
    sourceType,
    total: uniqueItems.length,
    saved,
    skipped,
    failed,
  });
}

/**
 * Crawl a WordPress RSS feed using a hybrid strategy: RSS for post listing
 * (dedup + skip-already-processed), Playwright for post body extraction.
 * The caller provides `processPost`, which captures the per-crawler selectors,
 * source type, locality, and delay via closure.
 */
export async function crawlHybridRss({
  feedUrl,
  sourceType,
  extractItems,
  discoverItems,
  processPost,
}: CrawlHybridRssOptions): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  logger.info("Starting crawler", { sourceType });

  let feedItems: RssFeedItem[];
  try {
    feedItems = discoverItems
      ? await discoverItems()
      : extractItems(await fetchFeedXml(feedUrl));
  } catch (error) {
    logger.error("Failed to fetch or parse RSS feed", {
      sourceType,
      feedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (feedItems.length === 0) {
    logger.warn("No posts found in RSS feed", { sourceType });
    return;
  }

  const uniqueItems = deduplicate(feedItems);

  logger.info("Fetched RSS feed", {
    sourceType,
    feedUrl,
    count: uniqueItems.length,
  });

  const newItems = await filterUnprocessed(uniqueItems, db, sourceType);
  const skipped = uniqueItems.length - newItems.length;

  if (newItems.length === 0) {
    logger.info("Crawl complete", {
      sourceType,
      total: uniqueItems.length,
      saved: 0,
      skipped,
      failed: 0,
    });
    return;
  }

  const browser = await launchBrowser();
  let saved = 0;
  let failed = 0;

  try {
    for (const item of newItems) {
      try {
        await processPost(browser, item, db);
        saved++;
      } catch (error) {
        failed++;
        logger.debug("Post processing failed", {
          sourceType,
          url: item.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await browser.close();
  }

  logger.info("Crawl complete", {
    sourceType,
    total: uniqueItems.length,
    saved,
    skipped,
    failed,
  });
}

function deduplicate(items: RssFeedItem[]): RssFeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

/**
 * Return only the feed items whose URLs have not been processed yet.
 * Lookups are sequential to avoid bursting Firestore read QPS.
 * If the lookup fails, skip the item to avoid overwriting an existing source
 * document (source writes use a non-merge set operation).
 */
export async function filterUnprocessed(
  items: RssFeedItem[],
  db: OboDb,
  sourceType: string,
): Promise<RssFeedItem[]> {
  const newItems: RssFeedItem[] = [];
  for (const item of items) {
    let wasProcessed = false;
    try {
      wasProcessed = await isUrlProcessed(item.url, db);
    } catch (error) {
      logger.error(
        "Failed to check existing URL state; skipping post to avoid duplicate writes",
        {
          sourceType,
          url: item.url,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      wasProcessed = true;
    }
    if (!wasProcessed) {
      newItems.push(item);
    }
  }
  return newItems;
}
