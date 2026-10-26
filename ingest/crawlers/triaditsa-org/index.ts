#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { createSource } from "@oboapp/source-triaditsa-org";
import { metadata } from "@oboapp/source-triaditsa-org/metadata";
import { runSource } from "@/sources/run-source";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const SOURCE_TYPE = metadata.id;

export async function crawl(): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const summary = await runSource(await getDb(), metadata, createSource);
  logger.info("Crawl complete", { sourceType: SOURCE_TYPE, ...summary });
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
