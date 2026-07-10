import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuthToken } from "@/lib/verifyAuthToken";

// POST - Mark a notification as read
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const body = await request.json();
    const { notificationId } = body;

    if (!notificationId) {
      return NextResponse.json(
        { error: "notificationId is required" },
        { status: 400 },
      );
    }

    const db = await getDb();

    // Verify the notification belongs to the user
    const notification = await db.notificationMatches.findById(notificationId);
    if (!notification || notification.userId !== userId) {
      return NextResponse.json(
        { error: "Notification not found" },
        { status: 404 },
      );
    }

    // Mark as read and set openedAt on first open (first-write-wins)
    const updateData: Record<string, string> = {
      readAt: new Date().toISOString(),
    };
    if (!notification.openedAt) {
      updateData.openedAt = new Date().toISOString();
    }
    await db.notificationMatches.updateOne(notificationId, updateData);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking notification as read:", error);

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
      { error: "Failed to mark notification as read" },
      { status: 500 },
    );
  }
}
