import type { OboDb, UpdateOperators } from "@oboapp/db";
import type { GeoJSONFeatureCollection } from "@/lib/types";
import { getSourceTrust, getGeometryQuality } from "@/lib/source-trust";
import type { MatchSignals } from "./score";
import { toISOString, toMs, isAlreadyExistsError } from "./utils";
import { logger } from "@/lib/logger";
import { getString, getNumber, getStringArray } from "@/lib/record-fields";

/**
 * Attach a message to an existing event.
 * Updates the event: merge timespans, upgrade geometry if better quality,
 * add source, increment messageCount.
 *
 * Uses atomic operators ($inc, $addToSet) for concurrency-safe updates.
 */
export async function attachMessageToEvent(
  db: OboDb,
  message: {
    _id: string;
    geoJson?: GeoJSONFeatureCollection | null;
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
    source?: string;
    categories?: string[];
    embedding?: number[] | null;
  },
  event: Record<string, unknown>,
  confidence: number,
  signals: MatchSignals,
): Promise<void> {
  const existingLinks = await db.eventMessages.findByMessageId(message._id);
  if (existingLinks.length > 0) {
    const linkedEventId = getString(existingLinks[0].eventId);
    if (linkedEventId !== getString(event._id)) {
      // Message already attached to a *different* event — normal idempotency guard.
      logger.info("Message already linked to a different event, skipping duplicate attach", {
        messageId: message._id,
        existingEventId: linkedEventId,
        attemptedEventId: event._id,
      });
      return;
    }
    // Same event: link creation succeeded on a previous run but the event doc update
    // may have been lost (transient DB error). Fall through to repair it.
    logger.info("Message link already exists; repairing event doc in case it is stale", {
      messageId: message._id,
      eventId: linkedEventId,
    });
  }
  const isRepair = existingLinks.length > 0;

  const source = typeof message.source === "string" ? message.source : "";
  const hasPrecomputedGeoJson = getSourceTrust(source).geometryQuality === 3;
  // Geometry quality is 0 when the message has no geoJson (e.g., city-wide messages)
  const newGeometryQuality = message.geoJson
    ? getGeometryQuality(source, hasPrecomputedGeoJson)
    : 0;
  const now = new Date().toISOString();
  const eventId = getString(event._id);

  // Build event update fields up-front so they're available in the already-exists
  // repair path as well as the normal path below.
  const setFields: Record<string, unknown> = { updatedAt: now };
  const addToSet: Record<string, unknown> = {};

  // Merge timespans (expand to union)
  if (message.timespanStart) {
    const msgStart = toMs(message.timespanStart);
    const evtStart = event.timespanStart ? toMs(getString(event.timespanStart)) : Infinity;
    if (msgStart < evtStart) {
      setFields.timespanStart = toISOString(message.timespanStart);
    }
  }
  if (message.timespanEnd) {
    const msgEnd = toMs(message.timespanEnd);
    const evtEnd = event.timespanEnd ? toMs(getString(event.timespanEnd)) : -Infinity;
    if (msgEnd > evtEnd) {
      setFields.timespanEnd = toISOString(message.timespanEnd);
    }
  }

  // Add source atomically (dedup handled by arrayUnion/$addToSet)
  if (source) {
    addToSet.sources = source;
  }

  // Add categories atomically (union via arrayUnion/$addToSet)
  if (message.categories?.length) {
    addToSet.categories = message.categories;
  }

  // Update embedding if new source has higher trust than all existing sources
  if (message.embedding?.length) {
    const existingSources = getStringArray(event.sources) ?? [];
    const newTrust = getSourceTrust(source).trust;
    const maxExistingTrust = existingSources.reduce(
      (max, src) => Math.max(max, getSourceTrust(src).trust),
      0,
    );
    if (newTrust >= maxExistingTrust || !event.embedding) {
      setFields.embedding = message.embedding;
    }
  }

  // Create EventMessage link (skipped on repair — link already exists).
  if (!isRepair) {
    try {
      await db.eventMessages.createOne(
        {
          eventId,
          messageId: message._id,
          source,
          confidence,
          geometryQuality: newGeometryQuality,
          matchSignals: signals,
          createdAt: now,
        },
        message._id,
      );
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        // Link was created by a concurrent worker. Treat this the same as the
        // repair path: fall through to update the event doc in case it is stale.
        logger.info("Message link created concurrently; repairing event doc", {
          messageId: message._id,
          attemptedEventId: eventId,
        });
        // Switch to repair mode: recount messageCount from eventMessages
        // (same as when findByMessageId found a pre-existing link above).
        const allLinks = await db.eventMessages.findByEventId(eventId);
        const repairUpdate: UpdateOperators = {
          $set: { ...setFields, messageCount: allLinks.length },
          ...(Object.keys(addToSet).length > 0 && { $addToSet: addToSet }),
        };
        await db.events.updateOne(eventId, repairUpdate);
        return;
      }
      throw error;
    }
  }

  // On repair, recount messageCount from the authoritative eventMessages collection
  // to correct any partial-failure drift rather than blindly incrementing.
  let atomicUpdate: UpdateOperators;
  if (isRepair) {
    const allLinks = await db.eventMessages.findByEventId(eventId);
    atomicUpdate = {
      $set: { ...setFields, messageCount: allLinks.length },
      ...(Object.keys(addToSet).length > 0 && { $addToSet: addToSet }),
    };
  } else {
    atomicUpdate = {
      $inc: { messageCount: 1 },
      $set: setFields,
      ...(Object.keys(addToSet).length > 0 && { $addToSet: addToSet }),
    };
  }

  await db.events.updateOne(eventId, atomicUpdate);

  // Geometry upgrade: separate step with fresh read to minimize stale-data window.
  // Re-read the event to get the latest geometryQuality before overwriting.
  if (message.geoJson && newGeometryQuality > 0) {
    const existingGeometryQuality = getNumber(event.geometryQuality);
    if (newGeometryQuality > existingGeometryQuality) {
      const freshEvent = await db.events.findById(eventId);
      const latestGeometryQuality = getNumber(freshEvent?.geometryQuality);
      if (newGeometryQuality > latestGeometryQuality) {
        await db.events.updateOne(eventId, {
          $set: { geoJson: message.geoJson, geometryQuality: newGeometryQuality },
        });
      }
    }
  }
}
