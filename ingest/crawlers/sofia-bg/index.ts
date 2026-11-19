#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import { createSource } from "@oboapp/source-sofia-bg";
import { metadata } from "@oboapp/source-sofia-bg/metadata";
import { logger } from "@/lib/logger";
import { runSource } from "@/sources/run-source";
import { loadSofiaHistory } from "./history";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

export async function crawl(): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const history = await loadSofiaHistory(db);
  const summary = await runSource(db, metadata, (context) => createSource(context, {
    isKnownArticle: history.isKnownArticle,
    onWarning(message, detail) {
      logger.warn(message, { sourceType: metadata.id, detail });
    },
  }), { history });
  logger.info("Crawl complete", { sourceType: metadata.id, ...summary });
  if (history.lookupErrors.length > 0) {
    throw new AggregateError(history.lookupErrors, "Sofia deduplication failed");
  }
}

if (require.main === module) {
  crawl().catch((error) => {
    logger.error("Fatal error", { sourceType: metadata.id, error });
    process.exit(1);
  });
}
