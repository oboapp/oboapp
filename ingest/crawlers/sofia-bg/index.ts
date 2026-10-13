#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright";
import type { OboDb } from "@oboapp/db";
import type { PostLink } from "./types";
import { articleTitleKey, articleUrlKey, extractPostDetails, mergePostDetails } from "./extractors";
import { discoverPosts, discoverListingPosts, NEWS_LISTING_URL } from "./discovery";
import { processWordpressPost } from "../shared/webpage-crawlers";
import { launchBrowser } from "../shared/browser";
import { isUrlProcessed } from "../shared/firestore";
import { logger } from "@/lib/logger";

// Load environment variables from .env.local
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const SOURCE_TYPE = "sofia-bg";
const LOCALITY = "bg.sofia";
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds

async function findNewPosts(
  posts: PostLink[],
  db: OboDb,
  isKnown: (post: PostLink) => boolean,
  errors: unknown[],
): Promise<PostLink[]> {
  const newPosts: PostLink[] = [];
  for (const post of posts) {
    try {
      if (!isKnown(post) && !(await isUrlProcessed(post.url, db))) {
        newPosts.push(post);
      }
    } catch (error) {
      logger.error("Dedup check failed, skipping post", {
        sourceType: SOURCE_TYPE,
        url: post.url,
        error: error instanceof Error ? error.message : String(error),
      });
      errors.push(error);
    }
  }
  return newPosts;
}

async function saveNewPosts(
  browser: Browser,
  posts: PostLink[],
  db: OboDb,
  isKnown: (post: PostLink) => boolean,
  markKnown: (post: PostLink) => void,
): Promise<{ saved: number; skipped: number; failed: number }> {
  const counts = { saved: 0, skipped: 0, failed: 0 };
  for (const post of posts) {
    if (isKnown(post)) {
      counts.skipped++;
      continue;
    }
    try {
      const extractDetailsWithDate = async (page: Page) =>
        mergePostDetails(await extractPostDetails(page), post);
      await processWordpressPost(
        browser,
        post,
        db,
        SOURCE_TYPE,
        LOCALITY,
        DELAY_BETWEEN_REQUESTS,
        extractDetailsWithDate,
        (date) => date, // Listing and RSS dates are already ISO 8601.
        "domcontentloaded", // Liferay's continuous activity prevents networkidle.
      );
      counts.saved++;
      markKnown(post);
    } catch (error) {
      counts.failed++;
      logger.warn("Failed to process post", {
        sourceType: SOURCE_TYPE,
        url: post.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return counts;
}

/**
 * Main crawler function
 */
export async function crawl(): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  logger.info("Starting crawler", { sourceType: SOURCE_TYPE });

  // Read both URL schemes and titles before discovery. A failed read must not
  // reset existing source documents to unprocessed and ingest duplicates.
  const existingSources = await db.sources.findMany({
    where: [{ field: "sourceType", op: "==", value: SOURCE_TYPE }],
    select: ["title", "url"],
  });
  const existingTitles = new Set(existingSources.flatMap((s) =>
    typeof s.title === "string" && s.title.trim() ? [articleTitleKey(s.title)] : [],
  ));
  const existingUrls = new Set(existingSources.flatMap((s) =>
    typeof s.url === "string" ? [articleUrlKey(s.url)] : [],
  ));
  const isKnown = (post: PostLink) =>
    existingUrls.has(articleUrlKey(post.url)) || existingTitles.has(articleTitleKey(post.title));

  let browser: Browser | undefined;
  try {
    const discoverListing = async (listingUrl?: string) => {
      browser ??= await launchBrowser();
      return discoverListingPosts(browser, isKnown, listingUrl);
    };
    const { posts: rawLinks, errors } = await discoverPosts(
      () => discoverListing(),
      () => discoverListing(NEWS_LISTING_URL),
    );

    // Deduplicate URL aliases across both discovery sources.
    const seen = new Set<string>();
    const postLinks: PostLink[] = rawLinks.filter((p) => {
      const key = articleUrlKey(p.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info("Fetched post list", {
      sourceType: SOURCE_TYPE,
      sources: 2,
      count: postLinks.length,
    });

    // URL and title checks cover RSS /content/id/... and legacy /w/... documents.
    const newPostLinks = await findNewPosts(postLinks, db, isKnown, errors);
    const skipped = postLinks.length - newPostLinks.length;

    if (newPostLinks.length === 0) {
      logger.info("Crawl complete", {
        sourceType: SOURCE_TYPE,
        total: postLinks.length,
        saved: 0,
        skipped,
        failed: 0,
      });
      if (errors.length) throw new AggregateError(errors, "Sofia discovery or deduplication failed");
      return;
    }

    browser ??= await launchBrowser();
    const counts = await saveNewPosts(browser, newPostLinks, db, isKnown, (post) => {
      existingTitles.add(articleTitleKey(post.title));
      existingUrls.add(articleUrlKey(post.url));
    });

    logger.info("Crawl complete", {
      sourceType: SOURCE_TYPE,
      total: postLinks.length,
      saved: counts.saved,
      skipped: skipped + counts.skipped,
      failed: counts.failed,
    });
    if (errors.length) throw new AggregateError(errors, "Sofia discovery or deduplication failed");
  } finally {
    await browser?.close();
  }
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
