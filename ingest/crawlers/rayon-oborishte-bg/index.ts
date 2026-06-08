#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import type { Browser } from "playwright";
import type { OboDb } from "@oboapp/db";
import type { PostLink } from "../shared/types";
import {
  extractFeedItems,
  mergePostDetails,
  extractPostDetails,
} from "./extractors";
import { fetchFeedXml } from "../shared/rss";
import { launchBrowser } from "../shared/browser";
import { isUrlProcessed } from "../shared/firestore";
import { processWordpressPost } from "../shared/webpage-crawlers";
import { logger } from "@/lib/logger";

// Load environment variables from .env.local
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const FEED_URL = "https://rayon-oborishte.bg/feed/";
const SOURCE_TYPE = "rayon-oborishte-bg";
const LOCALITY = "bg.sofia";
const DELAY_BETWEEN_REQUESTS = 2000;

/**
 * Process a single post
 */
const processPost = (browser: Browser, postLink: PostLink, db: OboDb) =>
  processWordpressPost(
    browser,
    postLink,
    db,
    SOURCE_TYPE,
    LOCALITY,
    DELAY_BETWEEN_REQUESTS,
    async (page) => mergePostDetails(await extractPostDetails(page), postLink),
    (dateText) => dateText,
  );

/**
 * Main crawler function
 */
export async function crawl(): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  logger.info("Starting crawler", { sourceType: SOURCE_TYPE });

  let feedItems: PostLink[];
  try {
    const xml = await fetchFeedXml(FEED_URL);
    feedItems = extractFeedItems(xml);
  } catch (error) {
    logger.error("Failed to fetch or parse RSS feed", {
      sourceType: SOURCE_TYPE,
      feedUrl: FEED_URL,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (feedItems.length === 0) {
    logger.warn("No posts found in RSS feed", { sourceType: SOURCE_TYPE });
    return;
  }

  const seen = new Set<string>();
  const uniqueItems = feedItems.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }

    seen.add(item.url);
    return true;
  });

  logger.info("Fetched RSS feed", {
    sourceType: SOURCE_TYPE,
    feedUrl: FEED_URL,
    count: uniqueItems.length,
  });

  // Filter out already-processed URLs before launching the browser so that
  // steady-state runs (feed unchanged since the last crawl) pay no Chromium
  // startup cost.
  const newItems = await filterUnprocessed(uniqueItems, db);
  const skipped = uniqueItems.length - newItems.length;

  if (newItems.length === 0) {
    logger.info("Crawl complete", {
      sourceType: SOURCE_TYPE,
      total: uniqueItems.length,
      saved: 0,
      skipped,
      failed: 0,
    });
    return;
  }

  const { saved, failed } = await processNewItems(newItems, db);

  logger.info("Crawl complete", {
    sourceType: SOURCE_TYPE,
    total: uniqueItems.length,
    saved,
    skipped,
    failed,
  });
}

/**
 * Return only the feed items whose URLs have not been processed yet.
 * Lookups are sequential to avoid bursting Firestore read QPS.
 * If the lookup fails, skip the item to avoid overwriting an existing source
 * document (source writes use a non-merge set operation).
 */
async function filterUnprocessed(
  items: PostLink[],
  db: OboDb,
): Promise<PostLink[]> {
  const newItems: PostLink[] = [];
  for (const item of items) {
    let wasProcessed = false;
    try {
      wasProcessed = await isUrlProcessed(item.url, db);
    } catch (error) {
      logger.error(
        "Failed to check existing URL state; skipping post to avoid duplicate writes",
        {
          sourceType: SOURCE_TYPE,
          url: item.url,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      wasProcessed = true;
    }
    if (!wasProcessed) newItems.push(item);
  }
  return newItems;
}

/**
 * Launch a browser, process each new post sequentially, and close the browser.
 */
async function processNewItems(
  items: PostLink[],
  db: OboDb,
): Promise<{ saved: number; failed: number }> {
  const browser = await launchBrowser();
  let saved = 0;
  let failed = 0;

  try {
    for (const item of items) {
      try {
        await processPost(browser, item, db);
        saved++;
      } catch (error) {
        failed++;
        // processWordpressPost already emits an error log with post-level context.
        logger.debug("Post processing failed", {
          sourceType: SOURCE_TYPE,
          url: item.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await browser.close();
  }

  return { saved, failed };
}

// Run the crawler if executed directly
if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", {
      sourceType: SOURCE_TYPE,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
