import { z } from "zod";

const count = z.number().int().nonnegative();
const totals = {
  processed: count,
  sent: count,
  failed: count,
  noSubscriptions: count,
  unknownDelivery: count,
  clicked: count,
  opened: count,
};

/** Public aggregate only: no user, match, message or device identifiers. */
export const NotificationsReportSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  periodStart: z.iso.datetime().nullable(),
  periodEnd: z.iso.datetime().nullable(),
  firstRecordedClickAt: z.iso.datetime().nullable(),
  kpis: z.object({ ...totals, uniqueUsers: count }),
  sources: z.array(z.object({ source: z.string().min(1), ...totals })),
});

export type NotificationsReportSnapshot = z.infer<
  typeof NotificationsReportSnapshotSchema
>;
export type NotificationsReportTotals = Omit<
  NotificationsReportSnapshot["kpis"],
  "uniqueUsers"
>;
