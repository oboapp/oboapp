import {
  NotificationsReportSnapshotSchema,
  type NotificationsReportSnapshot,
} from "@oboapp/shared";

export async function saveNotificationsReportSnapshot(
  snapshot: NotificationsReportSnapshot,
): Promise<void> {
  const bucket = process.env.GCS_GENERIC_BUCKET?.trim();
  if (!bucket)
    throw new Error(
      "GCS_GENERIC_BUCKET is required to save the notifications report",
    );
  const { Storage } = await import("@google-cloud/storage");
  // Cloud Run's execution identity has bucket access; the Firebase key does not.
  const storage = new Storage();
  await storage
    .bucket(bucket)
    .file("notifications/report.json")
    .save(JSON.stringify(NotificationsReportSnapshotSchema.parse(snapshot)), {
      contentType: "application/json",
    });
}
