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
import { parseBulgarianDate, parseBulgarianMonthDate } from "../shared/date-utils";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const INDEX_URL = "https://krasnapolyana.bg/home/latest-news";
const SOURCE_TYPE = "krasna-polyana-org";
const LOCALITY = "bg.sofia";
const DELAY_BETWEEN_REQUESTS = 2000;

export function parseKrasnaPolyanaDate(dateText: string): string {
  const normalized = dateText.trim();

  if (!normalized) {
    throw new Error("Missing date text for krasna-polyana-org post");
  }

  const isoTimestamp = Date.parse(normalized);
  if (!Number.isNaN(isoTimestamp)) {
    return new Date(isoTimestamp).toISOString();
  }

  if (/\d{1,2}\s+[а-яА-Я]+\s+\d{4}/.test(normalized)) {
    return parseBulgarianMonthDate(normalized);
  }

  return parseBulgarianDate(normalized);
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
    parseKrasnaPolyanaDate,
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
      sourceType: SOURCE_TYPE,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
