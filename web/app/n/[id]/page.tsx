import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Server-side click-tracking redirect for push notifications.
 *
 * Push notifications point to /n/<matchId> instead of the message URL
 * directly. When the browser navigates here (i.e., the user tapped the
 * notification), this page:
 *   1. Records clickedAt on the notification match (first-write-wins).
 *   2. Redirects to /?messageId=<messageId> so the message detail opens.
 *
 * The matchId in the path is the proof-of-click token — no auth token is
 * needed. Graceful fallback to "/" for missing/unknown IDs.
 */
export default async function NotificationRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!id) {
    redirect("/");
  }

  const db = await getDb();
  const match = await db.notificationMatches.findById(id);

  if (!match) {
    redirect("/");
  }

  const messageId = match.messageId;
  if (typeof messageId !== "string" || !messageId) {
    redirect("/");
  }

  if (!match.clickedAt) {
    await db.notificationMatches.updateOne(id, {
      clickedAt: new Date().toISOString(),
    });
  }

  redirect(`/?messageId=${encodeURIComponent(messageId)}`);
}
