#!/usr/bin/env tsx
/**
 * Re-processes a single message by its ID.
 *
 * Looks up the message's source document, deletes all sibling messages
 * from that source, then re-runs messageIngest from scratch.
 *
 * Usage:
 *   pnpm reprocess-message LQ8D9Bkp            # dry-run (safe)
 *   pnpm reprocess-message LQ8D9Bkp --execute   # actually run
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import type { OboDb } from "@oboapp/db";
import {
  deleteMessagesWithRelations,
  logCleanupStats,
} from "./message-cleanup";

function parseTimestamp(value: unknown): Date | undefined {
  if (value == null) return undefined;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // Handle Firestore Timestamp-like objects with a toDate() method
  const maybeTs = value as { toDate?: () => unknown };
  if (typeof maybeTs.toDate === "function") {
    try {
      const converted = maybeTs.toDate();
      if (converted instanceof Date && !isNaN(converted.getTime())) {
        return converted;
      }
    } catch {
      // Fall through
    }
  }

  return undefined;
}

async function main(messageId: string, dryRun: boolean) {
  const { getDb, closeDb } = await import("@/lib/db");
  const db = await getDb();

  try {
    const msg = await db.messages.findById(messageId);
    if (!msg) {
      console.error(`❌ Message "${messageId}" not found`);
      process.exitCode = 1;
      return;
    }

    const sourceDocumentId = msg.sourceDocumentId as string;
    if (!sourceDocumentId) {
      console.error(`❌ Message "${messageId}" has no sourceDocumentId`);
      process.exitCode = 1;
      return;
    }

    const snippet = ((msg.text ?? msg.plainText ?? "") as string).slice(0, 100);
    console.log(`\nFound message: ${messageId}`);
    console.log(`  Source: ${sourceDocumentId}`);
    console.log(`  Text:   "${snippet}..."\n`);

    const source = await db.sources.findById(sourceDocumentId);
    if (!source) {
      console.error(`❌ Source "${sourceDocumentId}" not found`);
      process.exitCode = 1;
      return;
    }

    if (!source.locality) {
      console.error(`❌ Source missing locality field`);
      process.exitCode = 1;
      return;
    }

    const allMsgsForSource = await db.messages.findBySourceDocumentIds(
      [sourceDocumentId],
      ["_id", "sourceDocumentId"],
    );

    if (dryRun) {
      console.log(
        `[dry-run] Would delete ${allMsgsForSource.length} message(s) and re-ingest from "${source.sourceType as string}"`,
      );
      console.log(
        `\n⚠️  DRY RUN — no changes made. Re-run with --execute to apply.`,
      );
      return;
    }

    await reingest(db, source, sourceDocumentId, allMsgsForSource);
  } finally {
    await closeDb();
  }
}

async function reingest(
  db: OboDb,
  source: Record<string, unknown>,
  sourceDocumentId: string,
  allMsgsForSource: Record<string, unknown>[],
) {
  console.log(
    `🗑️  Deleting ${allMsgsForSource.length} message(s) and related records...`,
  );
  const cleanupStats = await deleteMessagesWithRelations(db, allMsgsForSource);
  logCleanupStats(cleanupStats, "  ");

  let geoJson = null;
  if (source.geoJson) {
    if (typeof source.geoJson === "string") {
      try {
        geoJson = JSON.parse(source.geoJson);
      } catch {
        console.warn(
          "⚠️  Failed to parse geoJson; continuing without it.",
          source.geoJson,
        );
      }
    } else {
      geoJson = source.geoJson;
    }
  }

  const crawledAt = parseTimestamp(source.crawledAt) ?? new Date();

  const userFacingUrl =
    source.deepLinkUrl === undefined
      ? (source.url as string)
      : (source.deepLinkUrl as string) || undefined;

  console.log(
    `🔄 Re-ingesting from source "${source.sourceType as string}"...`,
  );
  const { messageIngest } = await import("@/messageIngest/index");

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
      timespanStart: parseTimestamp(source.timespanStart),
      timespanEnd: parseTimestamp(source.timespanEnd),
      cityWide: source.cityWide as boolean | undefined,
      locality: source.locality as string,
    },
  );

  const withGeoJson = result.messages.filter(
    (m) => m.geoJson && m.geoJson.features.length > 0,
  ).length;
  const stillFailed = result.messages.length - withGeoJson;

  console.log(`\n${"─".repeat(55)}`);
  console.log(`Created ${result.messages.length} message(s)`);
  console.log(
    `  GeoJSON: ${withGeoJson} got geometry, ${stillFailed} still without`,
  );
  for (const m of result.messages) {
    console.log(`  ${m.id}: features=${m.geoJson?.features?.length ?? 0}`);
  }
  console.log(`${"─".repeat(55)}\n`);
}

const program = new Command();

program
  .name("reprocess-message")
  .description("Re-process a single message by its ID")
  .argument("<messageId>", "The message ID to reprocess")
  .option(
    "--execute",
    "Actually apply changes (default is dry-run — safe to run without this flag)",
  )
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm reprocess-message LQ8D9Bkp              # dry-run
  $ pnpm reprocess-message LQ8D9Bkp --execute    # actually run
`,
  )
  .action(async (messageId: string, opts) => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    const dryRun = !opts.execute;
    await main(messageId, dryRun);
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
