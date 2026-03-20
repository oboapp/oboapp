import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuthToken } from "@/lib/verifyAuthToken";

// POST - Mark all notifications as read for the user
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const db = await getDb();

    // Get all notification IDs for the user that have been notified (only fetch _id to minimize data transfer)
    // Note: Cannot query "readAt == null" reliably in Firestore for missing fields,
    // so fetch all notified and filter client-side for unread
    const allNotifications = await db.notificationMatches.findMany({
      where: [
        { field: "userId", op: "==", value: userId },
        { field: "notified", op: "==", value: true },
      ],
      select: ["_id", "readAt"],
    });
    
    // Filter to only unread notifications (readAt missing, null, or empty)
    const unreadNotifications = allNotifications.filter(
      (n) => !n.readAt || n.readAt === null || n.readAt === "",
    );

    // Mark each as read, in batches to avoid unbounded concurrency
    const readAt = new Date().toISOString();
    const notificationIds = unreadNotifications
      .map((notification) => notification._id)
      .filter((id): id is string => typeof id === "string" && id !== "");

    const BATCH_SIZE = 100;
    for (let i = 0; i < notificationIds.length; i += BATCH_SIZE) {
      const batchIds = notificationIds.slice(i, i + BATCH_SIZE);
      const batchPromises = batchIds.map((id) =>
        db.notificationMatches.updateOne(id, { readAt }),
      );
      await Promise.all(batchPromises);
    }

    return NextResponse.json({
      success: true,
      count: notificationIds.length,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);

    if (
      error instanceof Error &&
      (error.message === "Missing auth token" ||
        error.message === "Invalid auth token")
    ) {
      return NextResponse.json(
        { error: `Unauthorized - ${error.message}` },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: "Failed to mark all notifications as read" },
      { status: 500 },
    );
  }
}
