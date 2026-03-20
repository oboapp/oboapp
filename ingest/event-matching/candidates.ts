import type { OboDb } from "@oboapp/db";
import { CANDIDATE_TIME_WINDOW_DAYS } from "./constants";

/**
 * Find candidate events that could match a given message.
 * Queries by locality + time window. Spatial filtering is done in scoring.
 */
export async function findCandidateEvents(
  db: OboDb,
  message: {
    locality: string;
    timespanStart?: string | Date | null;
    timespanEnd?: string | Date | null;
    cityWide?: boolean;
  },
): Promise<Record<string, unknown>[]> {
  const windowMs = CANDIDATE_TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Use message timespan if available, otherwise use current time as a point
  const now = new Date();
  const msgStart = message.timespanStart
    ? new Date(message.timespanStart)
    : now;
  const msgEnd = message.timespanEnd ? new Date(message.timespanEnd) : now;

  const timeWindowStart = new Date(msgStart.getTime() - windowMs);
  const timeWindowEnd = new Date(msgEnd.getTime() + windowMs);

  return db.events.findCandidates(
    message.locality,
    timeWindowStart,
    timeWindowEnd,
    { cityWideOnly: message.cityWide === true },
  );
}
