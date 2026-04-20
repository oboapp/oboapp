#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import type { Browser } from "playwright";
import type { OboDb } from "@oboapp/db";
import { PostLink } from "./types";
import {
  extractPostLinks,
  extractPostDetails,
  parseSerdikaDate,
} from "./extractors";
import {
  crawlWordpressPage,
  processWordpressPost,
} from "../shared/webpage-crawlers";
import { launchBrowser } from "../shared/browser";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const INDEX_URLS = [
  "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/messages",
  "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/news",
  "https://serdika.egov.bg/wps/portal/municipality-serdika/actual/events",
];
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
    DELAY_BETWEEN_REQUESTS,
    extractPostDetails,
    parseSerdikaDate,
    "load",
  );

export async function crawl(): Promise<void> {
  const browser = await launchBrowser();
  try {
    for (const indexUrl of INDEX_URLS) {
      await crawlWordpressPage({
        indexUrl,
        sourceType: SOURCE_TYPE,
        extractPostLinks,
        processPost,
        delayBetweenRequests: DELAY_BETWEEN_REQUESTS,
        waitUntil: "load",
        browser,
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
