#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { createSource, type RssFeedFetchEvent } from "@oboapp/source-lozenets-sofia-bg";
import { metadata } from "@oboapp/source-lozenets-sofia-bg/metadata";
import { createSourceCrawler } from "@/sources/create-source-crawler";
import { logger } from "@/lib/logger";
import { reportSourceBreadcrumb } from "@/lib/sentry";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

function reportFeedEvent(event: RssFeedFetchEvent): void {
  const context = {
    sourceType: metadata.id,
    feedUrl: event.url,
    pagination: event.pagination,
  };
  if (event.type === "retry") {
    reportSourceBreadcrumb("RSS feed retry scheduled", {
      ...context,
      diagnosticCode: "rss-feed-retry",
      feedAttempt: event.attempt,
      nextFeedAttempt: event.nextAttempt,
      retryDelayMs: event.delayMs,
      retryReason: event.reason,
      httpStatus: event.status,
      networkCode: event.code,
    }, "warning");
    return;
  }
  reportSourceBreadcrumb("RSS feed recovered after retry", {
    ...context,
    diagnosticCode: "rss-feed-recovered",
    feedAttempts: event.attempts,
  }, "info");
}

export const crawl = createSourceCrawler(metadata, (context) => {
  return createSource(context, { onEvent: reportFeedEvent });
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
