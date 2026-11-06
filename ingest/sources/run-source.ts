import type { OboDb } from "@oboapp/db";
import { SOURCES_COLLECTION } from "@oboapp/db";
import type { CreateSource, DataSource, DiscoveredItem, SourceMetadata } from "@oboapp/source-sdk";
import { serializeDiscoveryPayload } from "@oboapp/source-sdk";
import { validateLocality } from "@oboapp/shared";
import { z } from "zod";
import { encodeDocumentId, isUrlProcessed } from "@/crawlers/shared/firestore";
import { logger } from "@/lib/logger";
import { getLocality } from "@/lib/target-locality";
import { parseSourceContent, type SourceContentValidation } from "./source-content";

interface RunSourceOptions {
  dryRun?: boolean;
  contentValidation?: SourceContentValidation;
}

const itemSchema = z.object({
  identifier: z.string().refine((value) => value.trim().length > 0, "Empty identifier"),
  observedAt: z.string().optional(),
  payload: z.unknown().optional(),
});
const pageSchema = z.object({ items: z.array(z.unknown()), nextCursor: z.string().optional() });

function parseItem(value: unknown): DiscoveredItem {
  const item = itemSchema.parse(value);
  return {
    identifier: item.identifier,
    ...(item.observedAt === undefined ? {} : { observedAt: item.observedAt }),
    ...(item.payload === undefined ? {} : { payload: JSON.parse(serializeDiscoveryPayload(item.payload)) }),
  };
}

async function saveNewSource(db: OboDb, identifier: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    // Create, never upsert: overlapping runs must not reset an ingested document.
    await db.client.createOne(SOURCES_COLLECTION, data, encodeDocumentId(identifier));
    return true;
  } catch (error) {
    const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
    if ((code === 6 || code === 11000 || code === "already-exists") && await isUrlProcessed(identifier, db)) {
      return false;
    }
    throw error;
  }
}

async function processItem(
  db: OboDb | null,
  source: DataSource,
  sourceType: string,
  locality: string,
  candidate: unknown,
  validation: SourceContentValidation,
): Promise<"saved" | "skipped" | "failed"> {
  let identifier: string | undefined;
  try {
    const item = parseItem(candidate);
    identifier = item.identifier;
    if (db && await isUrlProcessed(identifier, db)) {
      return "skipped";
    }
    const content = parseSourceContent(await source.fetchItem(item), validation);
    if (!db) {
      return "saved";
    }
    const saved = await saveNewSource(db, identifier, {
      ...content, url: identifier, sourceType, locality, crawledAt: new Date(), processed: false,
    });
    return saved ? "saved" : "skipped";
  } catch (error) {
    logger.warn("Source item failed; retry on the next scheduled scan", { sourceType, identifier, error });
    return "failed";
  }
}

/** One scheduled scan. Missing items are retried by listing again on the next run. */
export async function runSource(
  db: OboDb | null,
  metadata: SourceMetadata,
  createSource: CreateSource,
  options: RunSourceOptions = {},
): Promise<{ saved: number; skipped: number; failed: number }> {
  if (!db && !options.dryRun) {
    throw new Error("A database is required unless dryRun is enabled");
  }
  const validation = options.contentValidation ?? "strict";
  if (validation === "legacy-toplo" && metadata.id !== "toplo-bg") {
    throw new Error("Legacy Toplo content validation requires the toplo-bg source");
  }
  const persistenceDb = options.dryRun ? null : db;
  const locality = getLocality();
  validateLocality(locality);
  if (!metadata.id.trim() || !metadata.localities.includes(locality)) {
    throw new Error("Source metadata does not support the configured locality");
  }
  const source = await createSource({ locality });
  const summary = { saved: 0, skipped: 0, failed: 0 };
  const cursors = new Set<string>();
  let cursor: string | undefined;
  try {
    do {
      const page = pageSchema.parse(await source.discoverItems(cursor));
      for (const candidate of page.items) {
        const outcome = await processItem(
          persistenceDb, source, metadata.id, locality, candidate, validation,
        );
        summary[outcome]++;
      }
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (cursors.has(cursor)) {
          throw new Error("Source returned a repeated pagination cursor");
        }
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
    return summary;
  } finally {
    await source.close?.();
  }
}
