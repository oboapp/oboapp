import type { CreateSource, SourceMetadata } from "@oboapp/source-sdk";
import { logger } from "@/lib/logger";
import { runSource } from "./run-source";

/** Defer database initialization until the configured entrypoint runs. */
export function createSourceCrawler(
  metadata: SourceMetadata,
  createSource: CreateSource,
): () => Promise<void> {
  return async function crawl(): Promise<void> {
    const { getDb } = await import("@/lib/db");
    const summary = await runSource(await getDb(), metadata, createSource);
    logger.info("Crawl complete", { sourceType: metadata.id, ...summary });
  };
}
