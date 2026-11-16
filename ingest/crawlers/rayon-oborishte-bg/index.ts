#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { createSource } from "@oboapp/source-rayon-oborishte-bg";
import { metadata } from "@oboapp/source-rayon-oborishte-bg/metadata";
import { createSourceCrawler } from "@/sources/create-source-crawler";
import { logger } from "@/lib/logger";
import { reportSourceWarning } from "@/lib/sentry";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

export const crawl = createSourceCrawler(metadata, (context) => {
  return createSource(context, {
    onRssFailure(error) {
      reportSourceWarning("RSS discovery failed; trying WordPress posts API", {
        sourceType: metadata.id,
        diagnosticCode: "rss-discovery-failure",
        feedUrl: "https://rayon-oborishte.bg/feed/",
        fallback: "wordpress-posts-api",
        error,
      });
    },
  });
});

if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", {
      sourceType: metadata.id,
      error,
    });
    process.exit(1);
  });
}
