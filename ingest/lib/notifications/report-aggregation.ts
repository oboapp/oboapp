import type {
  NotificationsReportSnapshot,
  NotificationsReportTotals,
} from "@oboapp/shared";

type DeliveryOutcome =
  | "sent"
  | "failed"
  | "noSubscriptions"
  | "unknownDelivery";

/** notified means processed; only explicit device success is evidence of an FCM send. */
function deliveryOutcome(value: unknown): DeliveryOutcome {
  if (!Array.isArray(value)) return "unknownDelivery";
  if (value.length === 0) return "noSubscriptions";
  if (value.some((device) => device?.success === true)) return "sent";
  if (value.every((device) => device?.success === false)) return "failed";
  return "unknownDelivery";
}

function dateString(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyTotals(): NotificationsReportTotals {
  return {
    processed: 0,
    sent: 0,
    failed: 0,
    noSubscriptions: 0,
    unknownDelivery: 0,
    clicked: 0,
    opened: 0,
  };
}

export function getSnapshotSource(
  match: Record<string, unknown>,
): string | null {
  const snapshot = match.messageSnapshot;
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("source" in snapshot)
  )
    return null;
  return typeof snapshot.source === "string" && snapshot.source.trim()
    ? snapshot.source
    : null;
}

/** Incremental aggregation shared by the real generator and its tests. */
export class NotificationsReportAggregator {
  private readonly totals = emptyTotals();
  private readonly users = new Set<string>();
  private readonly sources = new Map<string, NotificationsReportTotals>();
  private periodStart: string | null = null;
  private periodEnd: string | null = null;
  private firstRecordedClickAt: string | null = null;

  add(match: Record<string, unknown>, source: string): void {
    const outcome = deliveryOutcome(match.deviceNotifications);
    const sourceTotals = this.sources.get(source) ?? emptyTotals();
    const clickedAt = dateString(match.clickedAt);
    const openedAt = dateString(match.openedAt);
    for (const totals of [this.totals, sourceTotals]) {
      totals.processed++;
      totals[outcome]++;
      // Engagement uses the same successful-send cohort as the sent denominator.
      if (outcome === "sent" && clickedAt) totals.clicked++;
      if (outcome === "sent" && openedAt) totals.opened++;
    }
    this.sources.set(source, sourceTotals);
    if (
      outcome === "sent" &&
      typeof match.userId === "string" &&
      match.userId
    ) {
      this.users.add(match.userId);
    }
    const notifiedAt = dateString(match.notifiedAt);
    if (notifiedAt) {
      if (!this.periodStart || notifiedAt < this.periodStart)
        this.periodStart = notifiedAt;
      if (!this.periodEnd || notifiedAt > this.periodEnd)
        this.periodEnd = notifiedAt;
    }
    if (
      outcome === "sent" &&
      clickedAt &&
      (!this.firstRecordedClickAt || clickedAt < this.firstRecordedClickAt)
    ) {
      this.firstRecordedClickAt = clickedAt;
    }
  }

  snapshot(generatedAt: Date): NotificationsReportSnapshot {
    return {
      version: 1,
      generatedAt: generatedAt.toISOString(),
      periodStart: this.periodStart,
      periodEnd: this.periodEnd,
      firstRecordedClickAt: this.firstRecordedClickAt,
      kpis: { ...this.totals, uniqueUsers: this.users.size },
      sources: Array.from(this.sources, ([source, totals]) => ({
        source,
        ...totals,
      })).sort((a, b) => b.sent - a.sent || a.source.localeCompare(b.source)),
    };
  }
}
