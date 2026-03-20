import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NotificationSubscription } from "@/lib/types";
import { verifyAuthToken } from "@/lib/verifyAuthToken";
import { toRequiredISOString } from "@/lib/date-serialization";

// GET - Check if user has a valid subscription
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const db = await getDb();
    const hasSubscription =
      await db.notificationSubscriptions.hasSubscription(userId);

    return NextResponse.json({ hasSubscription });
  } catch (error) {
    console.error("Error checking subscription:", error);
    return NextResponse.json(
      { error: "Failed to check subscription" },
      { status: 500 },
    );
  }
}

// POST - Create or update notification subscription
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const body = await request.json();
    const { token, endpoint, deviceInfo: rawDeviceInfo } = body;

    if (!token || !endpoint) {
      return NextResponse.json(
        { error: "Token and endpoint are required" },
        { status: 400 },
      );
    }

    const deviceInfo =
      typeof rawDeviceInfo === "object" && rawDeviceInfo !== null && !Array.isArray(rawDeviceInfo)
        ? rawDeviceInfo
        : {};

    const db = await getDb();
    const now = new Date();

    // Check if subscription already exists for this user
    const existing = await db.notificationSubscriptions.findByUserAndToken(
      userId,
      token,
    );

    if (existing) {
      // Update existing subscription
      const docId = typeof existing._id === "string" ? existing._id : "";
      if (!docId) {
        return NextResponse.json(
          { error: "Existing subscription has no valid ID" },
          { status: 500 },
        );
      }
      await db.notificationSubscriptions.updateOne(docId, {
        endpoint,
        deviceInfo: deviceInfo || {},
        updatedAt: now,
      });

      const updatedDoc = await db.notificationSubscriptions.findById(docId);
      if (!updatedDoc) {
        throw new Error(
          "Subscription update succeeded but updated record was not found",
        );
      }

      const subscription: NotificationSubscription = {
        id: docId,
        userId: typeof updatedDoc.userId === "string" ? updatedDoc.userId : "",
        token: typeof updatedDoc.token === "string" ? updatedDoc.token : "",
        endpoint: typeof updatedDoc.endpoint === "string" ? updatedDoc.endpoint : "",
        createdAt: toRequiredISOString(updatedDoc.createdAt, "createdAt"),
        updatedAt: toRequiredISOString(updatedDoc.updatedAt, "updatedAt"),
        deviceInfo:
          typeof updatedDoc.deviceInfo === "object" &&
          updatedDoc.deviceInfo !== null
            ? updatedDoc.deviceInfo
            : {},
      };

      return NextResponse.json(subscription);
    }

    // Create new subscription
    const docId = await db.notificationSubscriptions.insertOne({
      userId,
      token,
      endpoint,
      deviceInfo: deviceInfo || {},
      createdAt: now,
      updatedAt: now,
    });

    const subscription: NotificationSubscription = {
      id: docId,
      userId,
      token,
      endpoint,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deviceInfo: deviceInfo || {},
    };

    return NextResponse.json(subscription);
  } catch (error) {
    console.error("Error creating subscription:", error);
    return NextResponse.json(
      { error: "Failed to create subscription" },
      { status: 500 },
    );
  }
}

// DELETE - Remove a specific notification subscription by token
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    // Get token from query parameters
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Token parameter is required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const existing = await db.notificationSubscriptions.findByUserAndToken(
      userId,
      token,
    );

    if (!existing) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 },
      );
    }

    // Delete the subscription
    const existingId = typeof existing._id === "string" ? existing._id : "";
    if (!existingId) {
      return NextResponse.json(
        { error: "Subscription record has no valid ID" },
        { status: 500 },
      );
    }
    await db.notificationSubscriptions.deleteOne(existingId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting subscription:", error);
    return NextResponse.json(
      { error: "Failed to delete subscription" },
      { status: 500 },
    );
  }
}
