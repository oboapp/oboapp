import type { OboDb, DbPageCursor } from "@oboapp/db";
import { isDeepStrictEqual } from "node:util";
import {
  getSnapshotSource,
  NotificationsReportAggregator,
} from "./report-aggregation";

const PAGE_SIZE = 500;
const MESSAGE_BATCH_SIZE = 10;

/** Only retain one page, source totals and distinct successful recipients in memory. */
export async function generateNotificationsReport(
  db: Pick<OboDb, "notificationMatches" | "messages">,
  generatedAt = new Date(),
) {
  const aggregator = new NotificationsReportAggregator();
  let after: DbPageCursor | undefined;
  while (true) {
    const page = await db.notificationMatches.findNotifiedPage(
      PAGE_SIZE,
      after,
    );
    const matches = page.documents;
    if (matches.length === 0) break;
    const missingSourceIds = [
      ...new Set(
        matches
          .filter((match) => !getSnapshotSource(match))
          .map((match) => match.messageId)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    ];
    const sources = new Map<string, string>();
    for (let i = 0; i < missingSourceIds.length; i += MESSAGE_BATCH_SIZE) {
      const messages = await db.messages.findMany({
        where: [
          {
            field: "_id",
            op: "in",
            value: missingSourceIds.slice(i, i + MESSAGE_BATCH_SIZE),
          },
        ],
        select: ["source"],
      });
      for (const message of messages) {
        if (
          typeof message._id === "string" &&
          typeof message.source === "string" &&
          message.source.trim()
        ) {
          sources.set(message._id, message.source);
        }
      }
    }
    for (const match of matches) {
      const fallback =
        typeof match.messageId === "string"
          ? sources.get(match.messageId)
          : undefined;
      aggregator.add(
        match,
        getSnapshotSource(match) ?? fallback ?? "(unknown)",
      );
    }
    if (!page.nextCursor || isDeepStrictEqual(after, page.nextCursor)) {
      throw new Error("Notification report cursor did not advance");
    }
    after = page.nextCursor;
    if (matches.length < PAGE_SIZE) break;
  }
  return aggregator.snapshot(generatedAt);
}
