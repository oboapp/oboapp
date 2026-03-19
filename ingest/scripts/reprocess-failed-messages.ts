#!/usr/bin/env node
/**
 * Re-processes finalized messages that have no GeoJSON (i.e. appeared on the
 * /ingest-errors page).
 *
 * Steps:
 *  1. Fetch all finalized messages without geoJson
 *  2. Group them by sourceDocumentId
 *  3. For each source: delete ALL messages from that source (so the
 *     "already ingested" guard in from-sources.ts won't block re-ingestion),
 *     then re-run messageIngest directly against the source document.
 *
 * Usage:
 *   pnpm tsx ingest/scripts/reprocess-failed-messages.ts            # dry-run (safe)
 *   pnpm tsx ingest/scripts/reprocess-failed-messages.ts --execute  # actually run
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import type { OboDb } from "@oboapp/db";
import {
  deleteMessagesWithRelations,
  logCleanupStats,
} from "./message-cleanup";

type MsgDoc = Record<string, unknown>;

function isFailedMessage(doc: MsgDoc): boolean {
  const geoJson = doc.geoJson;
  if (!geoJson) return true;
  if (typeof geoJson === "string" && geoJson.trim() === "") return true;
  if (
    typeof geoJson === "object" &&
    "features" in geoJson &&
    Array.isArray((geoJson as { features: unknown[] }).features) &&
    (geoJson as { features: unknown[] }).features.length === 0
  )
    return true;
  return false;
}

function groupBySource(failed: MsgDoc[]): Map<string, MsgDoc[]> {
  const bySource = new Map<string, MsgDoc[]>();
  for (const msg of failed) {
    const sid = msg.sourceDocumentId as string | undefined;
    if (!sid) {
      console.warn(
        `⚠️  Message ${msg._id as string} has no sourceDocumentId — skipping`,
      );
      continue;
    }
    const bucket = bySource.get(sid);
    if (bucket) {
      bucket.push(msg);
    } else {
      bySource.set(sid, [msg]);
    }
  }
  return bySource;
}

function parseTimestamp(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  return value ? new Date(value as string) : undefined;
}

interface SourceResult {
  created: number;
  withGeoJson: number;
  stillFailed: number;
}

async function processSource(
  db: OboDb,
  sourceDocumentId: string,
  msgs: MsgDoc[],
  dryRun: boolean,
): Promise<SourceResult> {
  console.log(`\n─── Source: ${sourceDocumentId}`);
  for (const m of msgs) {
    const snippet = ((m.text ?? m.plainText ?? "") as string).slice(0, 80);
    console.log(`  📄 ${m._id as string}  "${snippet}..."`);
  }

  const source = await db.sources.findById(sourceDocumentId);
  if (!source) {
    throw new Error(`Source document not found`);
  }

  if (!source.locality) {
    throw new Error(`Source missing locality field`);
  }

  if (dryRun) {
    console.log(
      `  [dry-run] Would delete ${msgs.length} message(s) and re-ingest from "${source.sourceType as string}"`,
    );
    return { created: 0, withGeoJson: 0, stillFailed: 0 };
  }

  // Fetch ALL messages with this sourceDocumentId (may include successful siblings
  // from a filterAndSplit that also need to be re-created consistently)
  const allMsgsForSource = await db.messages.findBySourceDocumentIds(
    [sourceDocumentId],
    ["_id", "sourceDocumentId"],
  );

  console.log(
    `  🗑️  Deleting ${allMsgsForSource.length} message(s) and related records...`,
  );
  const cleanupStats = await deleteMessagesWithRelations(db, allMsgsForSource);
  logCleanupStats(cleanupStats, "  ");

  // Parse precomputed geoJson if present
  let geoJson = null;
  if (source.geoJson) {
    geoJson =
      typeof source.geoJson === "string"
        ? JSON.parse(source.geoJson)
        : source.geoJson;
  }

  const crawledAt =
    source.crawledAt instanceof Date
      ? source.crawledAt
      : new Date(
          (source.crawledAt as string | number | undefined) ?? Date.now(),
        );

  const timespanStart = parseTimestamp(source.timespanStart);
  const timespanEnd = parseTimestamp(source.timespanEnd);

  const userFacingUrl =
    source.deepLinkUrl === undefined
      ? (source.url as string)
      : (source.deepLinkUrl as string) || undefined;

  console.log(
    `  🔄 Re-ingesting from source "${source.sourceType as string}"...`,
  );
  const { messageIngest } = await import("../messageIngest/index");

  const result = await messageIngest(
    source.message as string,
    source.sourceType as string,
    {
      precomputedGeoJson: geoJson,
      sourceUrl: userFacingUrl,
      sourceDocumentId,
      crawledAt,
      markdownText: source.markdownText as string | undefined,
      categories: source.categories as string[] | undefined,
      isRelevant: source.isRelevant as boolean | undefined,
      timespanStart,
      timespanEnd,
      cityWide: source.cityWide as boolean | undefined,
      locality: source.locality as string,
    },
  );

  const withGeoJson = result.messages.filter(
    (m) => m.geoJson && m.geoJson.features.length > 0,
  ).length;
  const stillFailed = result.messages.length - withGeoJson;

  const createdIds = result.messages.map((m) => m.id).join(", ");
  console.log(
    `  ✅ Done — created ${result.messages.length} message(s): ${createdIds}`,
  );
  console.log(
    `     GeoJSON: ${withGeoJson} got geometry, ${stillFailed} still without`,
  );

  return { created: result.messages.length, withGeoJson, stillFailed };
}

async function main(dryRun: boolean, daysBack: number) {
  const { getDb } = await import("../lib/db");
  const db = await getDb();

  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  console.log(
    `\n🔍 Fetching finalized messages without GeoJSON (last ${daysBack} days, since ${since.toISOString().slice(0, 10)})...\n`,
  );

  const allFinalized = await db.messages.findMany({
    where: [{ field: "finalizedAt", op: ">", value: since }],
    orderBy: [{ field: "finalizedAt", direction: "desc" }],
    limit: 1000,
  });

  const failed = allFinalized.filter(isFailedMessage);

  if (failed.length === 0) {
    console.log("✅ No failed messages found. Nothing to do.");
    return;
  }

  const unreadable = failed.filter((m) => m.isUnreadable === true);
  const retryable = failed.filter((m) => m.isUnreadable !== true);

  if (unreadable.length > 0) {
    console.log(
      `ℹ️  ${unreadable.length} message(s) marked isUnreadable=true — skipping (AI-determined document-only redirects)`,
    );
  }

  const bySource = groupBySource(retryable);
  console.log(
    `Found ${retryable.length} retryable message(s) across ${bySource.size} source(s)\n`,
  );

  const stats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    messagesCreated: 0,
    messagesWithGeoJson: 0,
    messagesStillFailed: 0,
  };

  for (const [sourceDocumentId, msgs] of bySource) {
    if (!dryRun) stats.attempted++;
    try {
      const result = await processSource(db, sourceDocumentId, msgs, dryRun);
      if (!dryRun) {
        stats.succeeded++;
        stats.messagesCreated += result.created;
        stats.messagesWithGeoJson += result.withGeoJson;
        stats.messagesStillFailed += result.stillFailed;
      }
    } catch (err) {
      if (!dryRun) stats.failed++;
      console.error(
        `  ❌ Failed for source ${sourceDocumentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (dryRun) {
    console.log(
      `\n⚠️  DRY RUN — no changes made. Re-run with --execute to apply.`,
    );
    console.log(
      `\nSummary (dry-run): Would attempt: ${bySource.size} source(s) (window: last ${daysBack} days)`,
    );
    console.log(
      `                   Skipped as unreadable: ${unreadable.length}`,
    );
    console.log();
  } else {
    console.log(`\n${"─".repeat(55)}`);
    console.log(
      `Sources  — Attempted: ${stats.attempted} | Succeeded: ${stats.succeeded} | Failed: ${stats.failed}`,
    );
    console.log(
      `Messages — Created: ${stats.messagesCreated} | Got GeoJSON: ${stats.messagesWithGeoJson} | Still failed: ${stats.messagesStillFailed}`,
    );
    console.log(`Skipped as unreadable: ${unreadable.length}`);
    console.log(`${"─".repeat(55)}\n`);
  }
}

const program = new Command();

program
  .name("reprocess-failed-messages")
  .description(
    "Re-process finalized messages that have no GeoJSON (ingest errors)",
  )
  .option(
    "--execute",
    "Actually apply changes (default is dry-run — safe to run without this flag)",
  )
  .option(
    "--days <n>",
    "Number of days back to search for failed messages",
    "14",
  )
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm tsx ingest/scripts/reprocess-failed-messages          # dry-run
  $ pnpm tsx ingest/scripts/reprocess-failed-messages --execute
  $ pnpm tsx ingest/scripts/reprocess-failed-messages --execute --days 30
`,
  )
  .action(async (opts) => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    const dryRun = !opts.execute;
    const daysBack = Number(opts.days);
    await main(dryRun, daysBack);
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
