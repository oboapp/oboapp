#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import type { Browser } from "playwright";
import type { OboDb } from "@oboapp/db";
import type { PostLink } from "./types";
import {
  fetchPostLinksFromFeed,
  extractPostDetails,
  parseSerdikaDate,
} from "./extractors";
import { processWordpressPost } from "../shared/webpage-crawlers";
import { isUrlProcessed } from "../shared/firestore";
import { launchBrowser } from "../shared/browser";
import { delay } from "@/lib/delay";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Each section maps to:
 *  - a WCM keyword used in the search feed (derived from the portal URL path)
 *  - the section label used in log messages
 */
const SECTIONS = [
  { keyword: "actualmessages", label: "messages" },
  { keyword: "actualnews", label: "news" },
  { keyword: "actualevents", label: "events" },
] as const;

const SOURCE_TYPE = "serdika-egov-bg";
const LOCALITY = "bg.sofia";
const DELAY_BETWEEN_REQUESTS = 2000;

const processPost = (browser: Browser, postLink: PostLink, db: OboDb) =>
  processWordpressPost(
    browser,
    postLink,
    db,
    SOURCE_TYPE,
    LOCALITY,
    0, // no need delayMs here, we already have a delay between posts in the main loop
    extractPostDetails,
    parseSerdikaDate,
    "load",
  );

export async function crawl(): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  const browser = await launchBrowser();
  try {
    for (const { keyword, label } of SECTIONS) {
      logger.info("Fetching post list from search feed", {
        sourceType: SOURCE_TYPE,
        section: label,
      });

      let postLinks: PostLink[];
      try {
        postLinks = await fetchPostLinksFromFeed(keyword);
      } catch (err) {
        logger.error("Failed to fetch post list", {
          sourceType: SOURCE_TYPE,
          section: label,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (postLinks.length === 0) {
        logger.warn("No posts found in feed", {
          sourceType: SOURCE_TYPE,
          section: label,
        });
        continue;
      }

      let saved = 0,
        skipped = 0,
        failed = 0;

      for (const postLink of postLinks) {
        const wasProcessed = await isUrlProcessed(postLink.url, db);
        if (wasProcessed) {
          skipped++;
          continue;
        }
        try {
          await processPost(browser, postLink, db);
          saved++;
        } catch (err) {
          failed++;
          logger.error("Error processing post", {
            sourceType: SOURCE_TYPE,
            url: postLink.url,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          await delay(DELAY_BETWEEN_REQUESTS);
        }
      }

      logger.info("Section complete", {
        sourceType: SOURCE_TYPE,
        section: label,
        total: postLinks.length,
        saved,
        skipped,
        failed,
      });
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", {
      sourceType: SOURCE_TYPE,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
