#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { Browser } from "playwright";
import type { OboDb } from "@oboapp/db";
import { PostLink } from "./types";
import { extractPostLinks, extractPostDetails } from "./extractors";
import {
  crawlWordpressPage,
  processWordpressPost,
} from "../shared/webpage-crawlers";
import { parseBulgarianMonthDate } from "../shared/date-utils";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const INDEX_URL = "https://vrabnitsa.sofia.bg/aktualno/news";
const SOURCE_TYPE = "vrabnitsa-org";
const LOCALITY = "bg.sofia";
const DELAY_BETWEEN_REQUESTS = 2000;

export function parseVrabnitsaDate(dateText: string): string {
  const cleaned = dateText.replace(/^Публикувано:\s*/i, "").trim();

  if (!cleaned) {
    logger.warn("Empty date text when parsing vrabnitsa date", {
      originalText: dateText,
      sourceType: SOURCE_TYPE,
    });
    // Avoid calling parseBulgarianMonthDate with an empty string to prevent
    // duplicate warnings and implicit "current date" fallback in the helper.
    // Instead, explicitly fall back to the current date here.
    return new Date().toISOString();
  }

  // Try ISO datetime first (from <time datetime="...">)
  const parsedIsoDate = new Date(cleaned);

  if (!Number.isNaN(parsedIsoDate.getTime())) {
    return parsedIsoDate.toISOString();
  }

  // Bulgarian month-name dates are the expected format for this source
  return parseBulgarianMonthDate(cleaned);
}

const processPost = (browser: Browser, postLink: PostLink, db: OboDb) =>
  processWordpressPost(
    browser,
    postLink,
    db,
    SOURCE_TYPE,
    LOCALITY,
    DELAY_BETWEEN_REQUESTS,
    extractPostDetails,
    parseVrabnitsaDate,
  );

export async function crawl(): Promise<void> {
  await crawlWordpressPage({
    indexUrl: INDEX_URL,
    sourceType: SOURCE_TYPE,
    extractPostLinks,
    processPost,
    delayBetweenRequests: DELAY_BETWEEN_REQUESTS,
  });
}

if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", {
      error: error instanceof Error ? error.message : String(error),
      sourceType: SOURCE_TYPE,
    });
    process.exit(1);
  });
}
