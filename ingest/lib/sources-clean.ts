import type { OboDb } from "@oboapp/db";
import { logger } from "@/lib/logger";

interface SourceDocument {
  sourceType: string;
  url: string;
  title: string;
}

/**
 * Get all source document IDs that have been ingested into messages
 */
async function getIngestedSourceIds(db: OboDb): Promise<Set<string>> {
  logger.info("Checking which sources have been ingested");

  const docs = await db.messages.findMany({
    select: ["sourceDocumentId"],
  });

  const ingestedIds = new Set<string>();
  for (const doc of docs) {
    const sourceDocId = typeof doc.sourceDocumentId === "string" ? doc.sourceDocumentId : "";
    if (sourceDocId) {
      ingestedIds.add(sourceDocId);
    }
  }

  logger.info("Found ingested sources", { count: ingestedIds.size });
  return ingestedIds;
}

/**
 * Delete all unprocessed sources except for the specified source type
 */
export async function cleanSources(
  retainSourceType: string,
  dryRun: boolean,
): Promise<void> {
  logger.info("Cleaning sources", { mode: dryRun ? "dry-run" : "production" });
  logger.info("Retaining source type", { retainSourceType });

  // Dynamically import db after env is loaded
  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  // Get all sources
  const allSources = await db.sources.findMany();
  logger.info("Total sources in database", { count: allSources.length });

  if (allSources.length === 0) {
    logger.info("No sources found in database");
    return;
  }

  // Get set of ingested source IDs
  const ingestedSourceIds = await getIngestedSourceIds(db);

  // Categorize sources
  const retained: SourceDocument[] = [];
  const toDelete: { id: string; doc: SourceDocument }[] = [];
  const ingested: SourceDocument[] = [];

  for (const data of allSources) {
    const sourceType = typeof data.sourceType === "string" ? data.sourceType : "";
    const id = typeof data._id === "string" ? data._id : "";
    const doc: SourceDocument = {
      sourceType,
      url: typeof data.url === "string" ? data.url : "",
      title: typeof data.title === "string" ? data.title : "",
    };

    // Keep sources of the retain type
    if (sourceType === retainSourceType) {
      retained.push(doc);
      continue;
    }

    // Keep sources that have been ingested
    if (ingestedSourceIds.has(id)) {
      ingested.push(doc);
      continue;
    }

    // Mark for deletion
    toDelete.push({ id, doc });
  }

  // Display summary
  logger.info("Source cleanup summary", {
    retainedByType: retained.length,
    retainSourceType,
    retainedByIngestion: ingested.length,
    toDelete: toDelete.length,
  });

  if (toDelete.length === 0) {
    logger.info("No sources to delete");
    return;
  }

  // Show samples of what will be deleted
  logger.info("Sources to delete (first 10)", {
    samples: toDelete.slice(0, 10).map(({ doc }) => `[${doc.sourceType}] ${doc.title.substring(0, 60)}`),
    remaining: toDelete.length > 10 ? toDelete.length - 10 : 0,
  });

  if (dryRun) {
    logger.info("Dry-run complete. No sources were deleted.");
    return;
  }

  // Delete sources in batches
  logger.info("Deleting sources");
  const idsToDelete = toDelete.map(({ id }) => id);
  await db.sources.deleteManyByIds(idsToDelete);

  logger.info("Successfully deleted unprocessed sources", { deleted: idsToDelete.length });
  logger.info("Retained sources", { count: retained.length + ingested.length });
}
