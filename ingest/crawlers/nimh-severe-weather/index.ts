#!/usr/bin/env node
import dotenv from "dotenv";
import { resolve } from "node:path";
import { parseWeatherPage, hasActiveWarnings } from "./parser";
import {
  buildUrl,
  buildTitle,
  buildMarkdownText,
  buildMessageText,
  buildTimespan,
} from "./builders";
import { launchBrowser } from "../shared/browser";
import { saveSourceDocumentIfNew } from "../shared/firestore";
import type { SourceDocumentWithGeoJson } from "../shared/types";
import type { GeoJSONFeatureCollection } from "../../lib/types";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const SOURCE_TYPE = "nimh-severe-weather";
const LOCALITY = "bg.sofia";
const TARGET_URL = "https://weather.bg/obshtini/index.php?z=u&o=SOF";

interface NimhSourceDocument extends SourceDocumentWithGeoJson {
  sourceType: typeof SOURCE_TYPE;
  cityWide: true;
}

type SourceDocument = NimhSourceDocument;

interface CrawlSummary {
  saved: number;
  skipped: number;
  failed: number;
  noWarnings: number;
}

/**
 * Create minimal GeoJSON for city-wide messages
 * Returns an empty FeatureCollection that satisfies non-null requirements
 * The cityWide flag in notify service handles matching against all users
 */
function createMinimalGeoJson(): GeoJSONFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export async function crawl(): Promise<void> {
  const summary: CrawlSummary = {
    saved: 0,
    skipped: 0,
    failed: 0,
    noWarnings: 0,
  };

  logger.info("Starting crawler", { sourceType: SOURCE_TYPE });

  logger.debug("Fetching weather warnings", { sourceType: SOURCE_TYPE, url: TARGET_URL });

  // Launch browser and fetch HTML
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle" });
    const html = await page.content();
    await browser.close();

    logger.debug("Parsing weather warnings", { sourceType: SOURCE_TYPE });

    // Parse the page
    const pageData = parseWeatherPage(html);

    if (!pageData) {
      logger.error("Failed to parse weather page", { sourceType: SOURCE_TYPE });
      process.exit(1);
    }

    // Check if there are any active warnings
    if (!hasActiveWarnings(pageData)) {
      logger.debug("No active weather warnings for Sofia", { sourceType: SOURCE_TYPE });
      summary.noWarnings++;
      printSummary(summary);
      return;
    }

    logger.debug("Found active weather warnings", { sourceType: SOURCE_TYPE, forecastDate: pageData.forecastDate });

    // Build source document
    const timespan = buildTimespan(pageData.forecastDate);
    const message = buildMessageText(pageData);
    const markdownText = buildMarkdownText(pageData);
    const url = buildUrl(pageData);

    const doc: SourceDocument = {
      url,
      datePublished: pageData.issuedAt,
      title: buildTitle(pageData),
      message,
      markdownText,
      sourceType: SOURCE_TYPE,
      locality: LOCALITY,
      crawledAt: new Date(),
      geoJson: createMinimalGeoJson(),
      categories: ["weather"],
      isRelevant: true,
      timespanStart: timespan.start,
      timespanEnd: timespan.end,
      cityWide: true,
    };

    // Load database (lazy)
    const { getDb } = await import("@/lib/db");
    const db = await getDb();

    const saved = await saveSourceDocumentIfNew(doc, db, {
      transformData: (d) => ({
        ...d,
        geoJson: JSON.stringify(d.geoJson),
        crawledAt: new Date(d.crawledAt),
      }),
      logSuccess: false,
    });

    if (saved) {
      logger.debug("Saved weather warning", { sourceType: SOURCE_TYPE, title: doc.title });
      summary.saved++;
    } else {
      logger.debug("Weather warning already exists", { sourceType: SOURCE_TYPE, title: doc.title });
      summary.skipped++;
    }
  } catch (error) {
    await browser.close();
    logger.error("Failed to crawl weather warnings", { sourceType: SOURCE_TYPE, error: error instanceof Error ? error.message : String(error) });
    summary.failed++;
  }

  printSummary(summary);

  // Exit with error if failed
  if (summary.failed > 0 && summary.saved === 0 && summary.skipped === 0) {
    process.exit(1);
  }
}

function printSummary(summary: CrawlSummary): void {
  const total = summary.saved + summary.skipped + summary.noWarnings;
  logger.info("Crawl complete", { sourceType: SOURCE_TYPE, total, saved: summary.saved, skipped: summary.skipped, noWarnings: summary.noWarnings, failed: summary.failed });
}

// Run if called directly
if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", { sourceType: SOURCE_TYPE, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
