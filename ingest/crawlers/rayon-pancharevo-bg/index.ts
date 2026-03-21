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
import {
  parseBulgarianDate,
  parseBulgarianDateOrRange,
  isDateRelevant,
} from "../shared/date-utils";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const INDEX_URL =
  "https://www.pancharevo.org/%D1%80%D0%B5%D0%BC%D0%BE%D0%BD%D1%82%D0%B8-%D0%B8-%D0%B8%D0%BD%D1%84%D1%80%D0%B0%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0";
const SOURCE_TYPE = "rayon-pancharevo-bg";
const LOCALITY = "bg.sofia";
const DELAY_BETWEEN_REQUESTS = 2000;

export function parsePancharevoDateToIso(dateText: string): string {
  const candidate = extractDateCandidate(dateText);

  if (candidate) {
    const range = parseBulgarianDateOrRange(candidate);
    return range.start.toISOString();
  }

  return parseBulgarianDate(dateText);
}

const processPost = (
  browser: Browser,
  postLink: PostLink,
  db: OboDb,
) =>
  processWordpressPost(
    browser,
    postLink,
    db,
    SOURCE_TYPE,
    LOCALITY,
    DELAY_BETWEEN_REQUESTS,
    extractPostDetails,
    parsePancharevoDateToIso,
  );

export function extractDateCandidate(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /(\d{1,2}\.\d{1,2}\s*-\s*\d{1,2}\.\d{1,2}\.\d{2,4})/i,
    /(\d{1,2}\s*-\s*\d{1,2}\.\d{1,2}\.\d{2,4})/i,
    /(\d{1,2}\.\d{1,2}\.\d{2,4})/i,
    /(\d{1,2}\s+[а-яА-Я]+(?:\s*\([^)]*\))?\s+\d{4}(?:\s*г\.)?)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export async function crawl(): Promise<void> {
  await crawlWordpressPage({
    indexUrl: INDEX_URL,
    sourceType: SOURCE_TYPE,
    extractPostLinks: async (page) => {
      const links = await extractPostLinks(page);

      return links.filter((link) => {
        const dateSource = `${link.date} ${link.title}`.trim();
        const dateCandidate = extractDateCandidate(dateSource);

        if (!dateCandidate) {
          logger.warn("Could not extract date from post listing; keeping for downstream processing", {
            sourceType: SOURCE_TYPE,
            url: link.url,
            title: link.title.substring(0, 80),
          });
          return true;
        }

        try {
          const range = parseBulgarianDateOrRange(dateCandidate);
          const relevant = isDateRelevant(range);

          if (!relevant) {
            logger.debug("Skipping outdated post", {
              url: link.url,
              title: link.title.substring(0, 80),
              dateCandidate,
            });
          }

          return relevant;
        } catch (error) {
          logger.warn("Failed to parse post date; keeping post", {
            sourceType: SOURCE_TYPE,
            url: link.url,
            dateCandidate,
            error: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
      });
    },
    processPost,
    delayBetweenRequests: DELAY_BETWEEN_REQUESTS,
  });
}

if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", { sourceType: SOURCE_TYPE, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
