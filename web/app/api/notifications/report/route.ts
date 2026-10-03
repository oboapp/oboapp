import { NextResponse } from "next/server";
import { NotificationsReportSnapshotSchema } from "@oboapp/shared/schema";
import { hasReportPagesEnabled } from "@/lib/report-pages";

export const runtime = "nodejs";

/** Public aggregate snapshot; never reads notification records during a request. */
export async function GET() {
  const bucket = process.env.GCS_GENERIC_BUCKET?.trim();
  if (!hasReportPagesEnabled() || !bucket) {
    return NextResponse.json(
      { error: "Report pages not configured" },
      { status: 503 },
    );
  }
  try {
    const { Storage } = await import("@google-cloud/storage");
    const storage = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? new Storage({
          credentials: JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
        })
      : new Storage();
    const file = storage.bucket(bucket).file("notifications/report.json");
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json(
        { error: "Notifications report not generated yet" },
        { status: 503 },
      );
    }
    const [content] = await file.download();
    // Parsing also strips fields outside the public contract.
    const snapshot = NotificationsReportSnapshotSchema.parse(
      JSON.parse(content.toString("utf-8")),
    );
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("Failed to load notifications report", error);
    return NextResponse.json(
      { error: "Failed to load notifications report" },
      { status: 500 },
    );
  }
}
