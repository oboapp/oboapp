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

type PageGotoWaitUntil = "load" | "domcontentloaded" | "networkidle";
type BlockableResourceType = "image" | "media" | "font";
const DEFAULT_WAIT_UNTIL: PageGotoWaitUntil = "domcontentloaded";
const DEFAULT_BLOCKED_RESOURCE_TYPES = ["image", "media", "font"] as const;

async function blockResourceTypes(
  page: Page,
  resourceTypes: readonly BlockableResourceType[] | undefined,
): Promise<void> {
  if (!resourceTypes?.length) return;

  const blockedTypes = new Set<string>(resourceTypes);

  await page.route("**/*", async (route) => {
    if (blockedTypes.has(route.request().resourceType())) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

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
  const {
    url,
    title,
    dateText,
    contentHtml,
    sourceType,
    locality,
    customDateParser,
  } = options;

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
  waitUntil: PageGotoWaitUntil = DEFAULT_WAIT_UNTIL,
  blockedResourceTypes:
    | readonly BlockableResourceType[]
    | undefined = DEFAULT_BLOCKED_RESOURCE_TYPES,
): Promise<void> {
  const { url } = postLink;
  const page = await browser.newPage();

  try {
    await blockResourceTypes(page, blockedResourceTypes);
    await page.goto(url, { waitUntil });

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
  } catch (error) {
    logger.error("Error processing post", {
      sourceType,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
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
  waitUntil?: PageGotoWaitUntil;
  blockedResourceTypes?: readonly BlockableResourceType[];
  browser?: Browser;
}): Promise<void> {
  const {
    indexUrl,
    sourceType,
    extractPostLinks,
    processPost,
    delayBetweenRequests: _delayBetweenRequests = 2000,
    waitUntil = DEFAULT_WAIT_UNTIL,
    blockedResourceTypes = DEFAULT_BLOCKED_RESOURCE_TYPES,
    browser: providedBrowser,
  } = options;

  logger.info("Starting crawler", { sourceType });

  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  let browser: Browser | null = null;
  const ownsBrowser = !providedBrowser;

  try {
    browser = providedBrowser ?? (await launchBrowser());

    const page = await browser.newPage();
    await blockResourceTypes(page, blockedResourceTypes);
    logger.debug("Fetching index page", { sourceType, url: indexUrl });
    await page.goto(indexUrl, { waitUntil });

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
        } else {
          await processPost(browser, postLink, db);
          savedCount++;
        }
      } catch (error) {
        failedCount++;
        logger.error("Error crawling wp page", {
          sourceType,
          url: postLink.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Crawl complete", {
      sourceType,
      total: postLinks.length,
      saved: savedCount,
      skipped: skippedCount,
      failed: failedCount,
    });
  } catch (error) {
    logger.error("Crawl failed", {
      sourceType,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (ownsBrowser && browser) {
      await browser.close();
    }
  }
}
