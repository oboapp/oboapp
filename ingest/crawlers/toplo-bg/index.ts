#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { createSource } from "@oboapp/source-toplo-bg";
import { metadata } from "@oboapp/source-toplo-bg/metadata";
import { runSource } from "@/sources/run-source";
import { logger } from "@/lib/logger";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

export async function crawl(dryRun = false): Promise<void> {
  const db = dryRun ? null : await (await import("@/lib/db")).getDb();
  const summary = await runSource(db, metadata, createSource, {
    dryRun,
    contentValidation: "legacy-toplo",
  });
  logger.info("Crawl complete", {
    sourceType: metadata.id,
    total: summary.saved + summary.skipped + summary.failed,
    ...summary,
  });
  if (summary.failed > 0 && summary.saved === 0 && summary.skipped === 0) {
    throw new Error("All incidents failed to process");
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
