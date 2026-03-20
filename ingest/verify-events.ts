#!/usr/bin/env node
/**
 * Verify event aggregation by inspecting events, messages, and their links.
 *
 * Works against a running Firestore (emulator or production) and shows
 * which messages are grouped into which events, with match scores.
 *
 * Usage:
 *   pnpm verify-events                         # show all events
 *   pnpm verify-events --source-name toplo-bg   # filter by source
 *   pnpm verify-events --event-id <id>          # inspect one event
 */
import { Command } from "commander";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { verifyDbEnv } from "@/lib/verify-env";
import { getString, getStringArray, getRecord } from "@/lib/record-fields";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const program = new Command();

program
  .name("verify-events")
  .description("Inspect event aggregation results: events, messages, match scores")
  .option("--source-name <name>", "Filter messages by source type")
  .option("--event-id <id>", "Inspect a specific event")
  .option("--verbose", "Show full event/message documents")
  .option("--limit <n>", "Maximum number of events to inspect (default: 50)", "50")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm verify-events
  $ pnpm verify-events --source-name toplo-bg
  $ pnpm verify-events --event-id abc123
  $ pnpm verify-events --limit 20
  $ pnpm verify-events --verbose
`,
  )
  .action(async (options) => {
    verifyDbEnv();

    const { getDb } = await import("@/lib/db");
    const db = await getDb();

    if (options.eventId) {
      await inspectEvent(db, options.eventId, options.verbose);
      return;
    }

    await showOverview(db, options.sourceName, options.verbose, parseInt(options.limit, 10));
  });

async function showOverview(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  sourceName?: string,
  verbose?: boolean,
  limit = 50,
): Promise<void> {
  // Fetch at most `limit` events to keep this tool safe to run on large datasets.
  const events = await db.events.findMany({
    orderBy: [{ field: "createdAt", direction: "desc" }],
    limit,
  });

  if (events.length === 0) {
    console.log("\n📭 No events found.\n");
    console.log("Tip: Run `pnpm ingest` first to ingest sources and create events.\n");
    return;
  }

  console.log(`\n📊 Found ${events.length} event(s)\n`);

  for (const event of events) {
    const eventId = getString(event._id);
    const eventMessages = await db.eventMessages.findByEventId(eventId);

    // If filtering by source, skip events that don't have messages from that source
    if (sourceName) {
      const hasSource = eventMessages.some(
        (em) => {
          return em.source === sourceName;
        },
      );
      // Also check event sources array
      const eventSources = getStringArray(event.sources) ?? [];
      if (!hasSource && !eventSources.includes(sourceName)) continue;
    }

    printEventSummary(event, eventMessages, verbose);
  }

  // Inspect finalized messages with geometry and compare against authoritative links.
  const messagesToInspect = await db.messages.findMany({
    where: sourceName
      ? [{ field: "source", op: "==", value: sourceName }]
      : undefined,
    limit: 100,
  });

  const finalizedWithGeometry = messagesToInspect.filter(
    (m) => m.finalizedAt && m.geoJson,
  );

  const orphans: Record<string, unknown>[] = [];
  const cacheMismatches: Array<{
    messageId: string;
    cachedEventId?: string;
    linkedEventIds: string[];
  }> = [];

  for (const message of finalizedWithGeometry) {
    const messageId = getString(message._id);
    const links = await db.eventMessages.findByMessageId(messageId);
    const linkedEventIds = links
      .map((link) => link.eventId)
      .filter((id): id is string => typeof id === "string");

    if (linkedEventIds.length === 0) {
      orphans.push(message);
      continue;
    }

    const cachedEventId =
      typeof message.eventId === "string" ? message.eventId : undefined;
    if (!cachedEventId || !linkedEventIds.includes(cachedEventId)) {
      cacheMismatches.push({ messageId, cachedEventId, linkedEventIds });
    }
  }

  if (orphans.length > 0) {
    console.log("━".repeat(60));
    console.log(
      `⚠️  ${orphans.length} finalized message(s) with GeoJSON but NO eventMessages link:`,
    );
    for (const m of orphans) {
      console.log(`  - ${m._id} (source: ${m.source}, categories: ${JSON.stringify(m.categories)})`);
    }
    console.log();
  }

  if (cacheMismatches.length > 0) {
    console.log("━".repeat(60));
    console.log(
      `⚠️  ${cacheMismatches.length} message(s) with eventMessages link but stale/missing message.eventId cache:`,
    );
    for (const mismatch of cacheMismatches) {
      console.log(
        `  - ${mismatch.messageId} (cached eventId: ${mismatch.cachedEventId ?? "none"}, linked eventIds: ${JSON.stringify(mismatch.linkedEventIds)})`,
      );
    }
    console.log();
  }
}

async function inspectEvent(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  eventId: string,
  verbose?: boolean,
): Promise<void> {
  const event = await db.events.findById(eventId);
  if (!event) {
    console.error(`\n❌ Event ${eventId} not found.\n`);
    process.exit(1);
  }

  const eventMessages = await db.eventMessages.findByEventId(eventId);
  printEventSummary(event, eventMessages, verbose);

  // Show each linked message
  for (const em of eventMessages) {
    const messageId = getString(em.messageId);
    const message = await db.messages.findById(messageId);
    if (message) {
      console.log(`  📝 Message: ${messageId}`);
      console.log(`     source: ${message.source}`);
      const messageText = getString(message.plainText) || getString(message.text);
      console.log(`     text: ${messageText.substring(0, 120)}`);
      console.log(`     categories: ${JSON.stringify(message.categories)}`);
      console.log(`     hasGeoJson: ${Boolean(message.geoJson)}`);
      console.log(`     hasEmbedding: ${Boolean(message.embedding)}`);
      console.log(`     eventId: ${message.eventId}`);
      if (verbose) {
        console.log(`     full document:`, JSON.stringify(message, null, 2));
      }
      console.log();
    }
  }
}

function printEventSummary(
  event: Record<string, unknown>,
  eventMessages: Record<string, unknown>[],
  verbose?: boolean,
): void {
  const eventId = getString(event._id);

  console.log("━".repeat(60));
  console.log(`🔗 Event: ${eventId}`);
  console.log(`   messages: ${event.messageCount ?? eventMessages.length}`);
  console.log(`   sources: ${JSON.stringify(event.sources)}`);
  console.log(`   categories: ${JSON.stringify(event.categories)}`);
  console.log(`   locality: ${event.locality}`);
  console.log(`   cityWide: ${event.cityWide ?? false}`);
  console.log(`   geometryQuality: ${event.geometryQuality ?? 0}`);
  console.log(`   timespan: ${event.timespanStart} → ${event.timespanEnd}`);
  console.log(`   text: ${getString(event.plainText).substring(0, 120)}`);

  if (verbose) {
    console.log(`   full document:`, JSON.stringify(event, null, 2));
  }

  if (eventMessages.length > 0) {
    console.log(`   ── linked messages ──`);
    for (const em of eventMessages) {
      const signals = getRecord(em.matchSignals);
      const fmtSig = (v: unknown): string => typeof v === "number" ? v.toFixed(2) : "?";
      console.log(
        `   ${em.messageId} (source: ${em.source}, confidence: ${em.confidence}${
          signals
            ? `, loc: ${fmtSig(signals.locationSimilarity)}, time: ${fmtSig(signals.timeOverlap)}, text: ${fmtSig(signals.textSimilarity)}, cat: ${fmtSig(signals.categoryMatch)}`
            : ""
        })`,
      );
    }
  }
  console.log();
}

program.parse();
