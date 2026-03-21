#!/usr/bin/env node
import dotenv from "dotenv";
import { resolve } from "node:path";
import { parseIncidents } from "./parser";
import { buildMessage, buildUrl, buildTitle } from "./builders";
import { launchBrowser } from "../shared/browser";
import { saveSourceDocumentIfNew } from "../shared/firestore";
import type { SourceDocumentWithGeoJson } from "../shared/types";
import { validateTimespanRange } from "@/lib/timespan-utils";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const SOURCE_TYPE = "toplo-bg";
const LOCALITY = "bg.sofia";
const TARGET_URL = "https://toplo.bg/accidents-and-maintenance";

interface ToploBgSourceDocument extends SourceDocumentWithGeoJson {
  sourceType: typeof SOURCE_TYPE;
}

type SourceDocument = ToploBgSourceDocument;

interface CrawlSummary {
  saved: number;
  skipped: number;
  failed: number;
}

export async function crawl(dryRun = false): Promise<void> {
  const summary: CrawlSummary = { saved: 0, skipped: 0, failed: 0 };

  logger.info("Starting crawler", { sourceType: SOURCE_TYPE });

  logger.debug("Fetching incidents", { sourceType: SOURCE_TYPE, url: TARGET_URL });

  // Launch browser and fetch HTML
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: "networkidle" });
  const html = await page.content();
  await browser.close();

  logger.debug("Parsing incidents", { sourceType: SOURCE_TYPE });

  // Parse incidents from HTML
  const incidents = parseIncidents(html);

  if (incidents.length === 0) {
    logger.error("No incidents found in HTML", { sourceType: SOURCE_TYPE });
    process.exit(1);
  }

  logger.debug("Found incidents", { sourceType: SOURCE_TYPE, count: incidents.length });

  // Load database (lazy)
  const db = dryRun
    ? null
    : await (await import("@/lib/db")).getDb();

  // Process each incident
  for (const incident of incidents) {
    try {
      const { info, geoJson } = incident;

      const message = buildMessage(
        info.Name,
        info.FromDate,
        info.Addresses,
        info.UntilDate,
      );

      // Extract timespans from incident info
      let timespanStart: Date;
      let timespanEnd: Date;

      try {
        const parsed = new Date(info.FromDate);
        if (validateTimespanRange(parsed)) {
          timespanStart = parsed;
        } else {
          logger.warn("FromDate outside valid range", { sourceType: SOURCE_TYPE, contentItemId: info.ContentItemId, fromDate: info.FromDate });
          timespanStart = new Date();
        }
      } catch (error) {
        logger.warn("Invalid FromDate", { sourceType: SOURCE_TYPE, contentItemId: info.ContentItemId, fromDate: info.FromDate, error: error instanceof Error ? error.message : String(error) });
        timespanStart = new Date();
      }

      try {
        // UntilDate can be null
        if (info.UntilDate) {
          const parsed = new Date(info.UntilDate);
          if (validateTimespanRange(parsed)) {
            timespanEnd = parsed;
          } else {
            logger.warn("UntilDate outside valid range", { sourceType: SOURCE_TYPE, contentItemId: info.ContentItemId, untilDate: info.UntilDate });
            timespanEnd = timespanStart;
          }
        } else {
          timespanEnd = timespanStart; // Use start date for both
        }
      } catch (error) {
        logger.warn("Invalid UntilDate", { sourceType: SOURCE_TYPE, contentItemId: info.ContentItemId, untilDate: info.UntilDate, error: error instanceof Error ? error.message : String(error) });
        timespanEnd = timespanStart;
      }

      const doc: SourceDocument = {
        url: buildUrl(info.ContentItemId),
        deepLinkUrl: "", // toplo.bg does not have individual incident pages
        datePublished: info.FromDate,
        title: buildTitle(info),
        message,
        markdownText: message, // Store for display in details view
        sourceType: SOURCE_TYPE,
        locality: LOCALITY,
        crawledAt: new Date(),
        geoJson,
        categories: ["heating"],
        isRelevant: true,
        timespanStart,
        timespanEnd,
      };

      if (dryRun) {
        logger.debug("Dry-run incident", { sourceType: SOURCE_TYPE, title: doc.title });
        summary.saved++;
      } else if (db) {
        const saved = await saveSourceDocumentIfNew(doc, db, {
          transformData: (d) => ({
            ...d,
            geoJson: JSON.stringify(d.geoJson),
            crawledAt: new Date(d.crawledAt),
          }),
          logSuccess: false,
        });
        if (saved) {
          logger.debug("Saved incident", { sourceType: SOURCE_TYPE, title: doc.title });
          summary.saved++;
        } else {
          summary.skipped++;
        }
      }
    } catch (error) {
      logger.warn("Failed to process incident", { sourceType: SOURCE_TYPE, error: error instanceof Error ? error.message : String(error) });
      summary.failed++;
    }
  }

  // Print summary
  logger.info("Crawl complete", { sourceType: SOURCE_TYPE, total: incidents.length, saved: summary.saved, skipped: summary.skipped, failed: summary.failed });

  // Exit with error if all failed
  if (summary.failed > 0 && summary.saved === 0 && summary.skipped === 0) {
    logger.error("All incidents failed to process", { sourceType: SOURCE_TYPE });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  crawl(false).catch((error) => {
    logger.error("Fatal error", { sourceType: SOURCE_TYPE, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
