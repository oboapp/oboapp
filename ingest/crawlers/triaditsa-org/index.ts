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
import { parseBulgarianDate } from "../shared/date-utils";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const INDEX_URL =
  "https://triaditza.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8/";
const SOURCE_TYPE = "triaditsa-org";
const LOCALITY = "bg.sofia";
const DELAY_BETWEEN_REQUESTS = 2000;

export function resolveTriaditsaDateText(
  extractedDateText: string,
  listingDateText: string,
): string {
  const normalizedExtracted = extractedDateText.trim();
  if (normalizedExtracted) {
    return normalizedExtracted;
  }

  const normalizedListing = listingDateText.trim();
  if (normalizedListing) {
    logger.warn(
      "Missing extracted post date for triaditsa-org post, falling back to listing date",
      { sourceType: SOURCE_TYPE },
    );
    return normalizedListing;
  }

  logger.warn(
    "Missing extracted and listing date for triaditsa-org post, falling back to current timestamp",
    { sourceType: SOURCE_TYPE },
  );
  return "";
}

export function parseTriaditsaDate(dateText: string): string {
  const normalized = dateText.trim();

  if (!normalized) {
    logger.warn(
      "Missing date text for triaditsa-org post, falling back to current timestamp",
      { sourceType: SOURCE_TYPE },
    );
    return new Date().toISOString();
  }

  const isoTimestamp = Date.parse(normalized);
  if (!Number.isNaN(isoTimestamp)) {
    return new Date(isoTimestamp).toISOString();
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
    async (page) => {
      const details = await extractPostDetails(page);
      return {
        ...details,
        dateText: resolveTriaditsaDateText(details.dateText, postLink.date),
      };
    },
    parseTriaditsaDate,
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
