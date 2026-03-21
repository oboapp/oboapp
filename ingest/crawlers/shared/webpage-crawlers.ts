import { parseBulgarianDate } from "./date-utils";
import { createTurndownService } from "./markdown";
import { Browser, Page } from "playwright";
import type { OboDb } from "@oboapp/db";
import { PostLink } from "./types";
import { launchBrowser } from "./browser";
import { isUrlProcessed, saveSourceDocument } from "./firestore";
import { delay } from "@/lib/delay";
import { logger } from "@/lib/logger";

const turndownService = createTurndownService();

/**
 * Build a SourceDocument from webpage content (HTML to Markdown conversion)
 * Used by WordPress-style crawlers like rayon-oborishte-bg and sofia-bg
 */
export function buildWebPageSourceDocument(options: {
  url: string;
  title: string;
  dateText: string;
  contentHtml: string;
  sourceType: string;
  locality: string;
  customDateParser?: (dateText: string) => string;
}): {
  url: string;
  title: string;
  datePublished: string;
  message: string;
  sourceType: string;
  locality: string;
} {
  const { url, title, dateText, contentHtml, sourceType, locality, customDateParser } = options;

  if (!title) {
    throw new Error(`Failed to extract title from ${url}`);
  }

  if (!contentHtml) {
    throw new Error(`Failed to extract content from ${url}`);
  }

  // Convert HTML to Markdown
  const message = turndownService.turndown(contentHtml);

  // Parse date to ISO format (use custom parser if provided)
  const datePublished = customDateParser
    ? customDateParser(dateText)
    : parseBulgarianDate(dateText);

  return {
    url,
    title,
    datePublished,
    message,
    sourceType,
    locality,
  };
}

/**
 * Process a single WordPress post
 * Generic implementation using buildWebPageSourceDocument
 */
export async function processWordpressPost<
  TPostLink extends PostLink,
  TDetails extends { title: string; dateText: string; contentHtml: string },
>(
  browser: Browser,
  postLink: TPostLink,
  db: OboDb,
  sourceType: string,
  locality: string,
  delayMs: number,
  extractPostDetails: (page: Page) => Promise<TDetails>,
  customDateParser?: (dateText: string) => string,
): Promise<void> {
  const { url, title } = postLink;

  logger.debug("Fetching post", { sourceType, url, title: title.substring(0, 60) });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle" });

    const details = await extractPostDetails(page);

    const postDetails = buildWebPageSourceDocument({
      url,
      title: details.title,
      dateText: details.dateText,
      contentHtml: details.contentHtml,
      sourceType,
      locality,
      customDateParser,
    });

    const sourceDoc = {
      ...postDetails,
      crawledAt: new Date(),
    };

    await saveSourceDocument(sourceDoc, db, { logSuccess: false });

    logger.debug("Saved post", { sourceType, title: title.substring(0, 60) });
  } catch (error) {
    logger.error("Error processing post", { sourceType, url, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await page.close();
  }

  await delay(delayMs);
}

/**
 * Crawl a WordPress-style news page
 * Generic crawler that extracts post links from an index page and processes each post
 */
export async function crawlWordpressPage(options: {
  indexUrl: string;
  sourceType: string;
  extractPostLinks: (page: Page) => Promise<PostLink[]>;
  processPost: (
    browser: Browser,
    postLink: PostLink,
    db: OboDb,
  ) => Promise<void>;
  delayBetweenRequests?: number;
}): Promise<void> {
  const {
    indexUrl,
    sourceType,
    extractPostLinks,
    processPost,
    delayBetweenRequests: _delayBetweenRequests = 2000,
  } = options;

  logger.info("Starting crawler", { sourceType });

  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();

    const page = await browser.newPage();
    logger.debug("Fetching index page", { sourceType, url: indexUrl });
    await page.goto(indexUrl, { waitUntil: "networkidle" });

    const postLinks = await extractPostLinks(page);
    await page.close();

    if (postLinks.length === 0) {
      logger.warn("No posts found on index page", { sourceType });
      return;
    }

    let savedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const postLink of postLinks) {
      try {
        const wasProcessed = await isUrlProcessed(postLink.url, db);

        if (wasProcessed) {
          skippedCount++;
          logger.debug("Skipped already processed post", { sourceType, title: postLink.title.substring(0, 60) });
        } else {
          await processPost(browser, postLink, db);
          savedCount++;
        }
      } catch (error) {
        failedCount++;
        logger.error("Error processing post", { sourceType, url: postLink.url, error: error instanceof Error ? error.message : String(error) });
      }
    }

    logger.info("Crawl complete", { sourceType, total: postLinks.length, saved: savedCount, skipped: skippedCount, failed: failedCount });
  } catch (error) {
    logger.error("Crawl failed", { sourceType, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
