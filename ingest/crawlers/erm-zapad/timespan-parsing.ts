import { parseBulgarianDateTime } from "../shared/date-utils";
import { validateTimespanRange } from "@/lib/timespan-utils";
import type { PinRecord } from "./types";
import { logger } from "@/lib/logger";

/**
 * Parse and validate timespans from pin record
 * Returns validated start/end dates or defaults to current time if parsing fails
 */
export function parseTimespans(pin: PinRecord): {
  timespanStart: Date;
  timespanEnd: Date;
} {
  const now = new Date();
  let timespanStart = now;
  let timespanEnd = now;

  // Parse start time
  try {
    if (pin.begin_event) {
      const parsed = parseBulgarianDateTime(pin.begin_event);
      if (validateTimespanRange(parsed)) {
        timespanStart = parsed;
      } else {
        logger.warn("begin_event outside valid range", { sourceType: "erm-zapad", eventId: pin.eventId, beginEvent: pin.begin_event });
      }
    }
  } catch (error) {
    logger.warn("Invalid begin_event", { sourceType: "erm-zapad", eventId: pin.eventId, beginEvent: pin.begin_event, error: error instanceof Error ? error.message : String(error) });
  }

  // Parse end time
  try {
    if (pin.end_event) {
      const parsed = parseBulgarianDateTime(pin.end_event);
      if (validateTimespanRange(parsed)) {
        timespanEnd = parsed;
      } else {
        logger.warn("end_event outside valid range", { sourceType: "erm-zapad", eventId: pin.eventId, endEvent: pin.end_event });
        timespanEnd = timespanStart;
      }
    } else if (pin.begin_event) {
      // Use start for both if only start available
      timespanEnd = timespanStart;
    }
  } catch (error) {
    logger.warn("Invalid end_event", { sourceType: "erm-zapad", eventId: pin.eventId, endEvent: pin.end_event, error: error instanceof Error ? error.message : String(error) });
    timespanEnd = timespanStart;
  }

  return { timespanStart, timespanEnd };
}
