import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NotificationSubscription } from "@/lib/types";
import { verifyAuthToken } from "@/lib/verifyAuthToken";
import { toRequiredISOString } from "@/lib/date-serialization";

// GET - Fetch all subscriptions for the user
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const db = await getDb();
    const docs = await db.notificationSubscriptions.findByUserId(userId);

    const subscriptions: NotificationSubscription[] = docs
      .filter((doc) => typeof doc._id === "string" && doc._id !== "")
      .map((doc) => ({
        id: typeof doc._id === "string" ? doc._id : "",
        userId: typeof doc.userId === "string" ? doc.userId : "",
        token: typeof doc.token === "string" ? doc.token : "",
        endpoint: typeof doc.endpoint === "string" ? doc.endpoint : "",
        createdAt: toRequiredISOString(doc.createdAt, "createdAt"),
        updatedAt: toRequiredISOString(doc.updatedAt, "updatedAt"),
        deviceInfo:
          typeof doc.deviceInfo === "object" && doc.deviceInfo !== null
            ? doc.deviceInfo
            : {},
      }))
      .sort((a, b) => {
        // Sort by createdAt descending (newest first)
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });

    return NextResponse.json(subscriptions);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 },
    );
  }
}

// DELETE - Remove all notification subscriptions for the user
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const db = await getDb();
    const count = await db.notificationSubscriptions.deleteAllByUserId(userId);

    return NextResponse.json({ success: true, deleted: count });
  } catch (error) {
    console.error("Error deleting subscriptions:", error);
    return NextResponse.json(
      { error: "Failed to delete subscriptions" },
      { status: 500 },
    );
  }
}
