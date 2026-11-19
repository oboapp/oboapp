#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { createSource } from "@oboapp/source-inspectorat-so-org";
import { metadata } from "@oboapp/source-inspectorat-so-org/metadata";
import { createSourceCrawler } from "@/sources/create-source-crawler";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

export const crawl = createSourceCrawler(metadata, createSource);

if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", {
      sourceType: metadata.id,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
