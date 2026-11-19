#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { createSource } from "@oboapp/source-sofiyska-voda";
import { metadata } from "@oboapp/source-sofiyska-voda/metadata";
import { logger } from "@/lib/logger";
import { runSource } from "@/sources/run-source";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

export async function crawl(): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const summary = await runSource(await getDb(), metadata, createSource);
  logger.info("Crawl complete", { sourceType: metadata.id, ...summary });
  if (summary.failed > 0 && summary.saved === 0 && summary.skipped === 0) {
    throw new Error("All Sofiyska Voda interruptions failed to process");
  }
}

if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", {
      sourceType: metadata.id,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
