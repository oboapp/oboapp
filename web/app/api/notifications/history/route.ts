import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NotificationHistoryItem } from "@/lib/types";
import { verifyAuthToken } from "@/lib/verifyAuthToken";
import {
  toOptionalISOString,
  toRequiredISOString,
} from "@/lib/date-serialization";

// GET - Fetch notification history items for the user with pagination
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    // Get pagination parameters from query string with validation
    const { searchParams } = new URL(request.url);
    
    const rawLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
    let limit = Number.isNaN(rawLimit) || rawLimit <= 0 ? 20 : rawLimit;
    limit = Math.min(limit, 100); // Max 100 items per request

    const rawOffset = Number.parseInt(searchParams.get("offset") ?? "", 10);
    const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const db = await getDb();
    
    // Fetch one extra item to check if there are more
    const docs = await db.notificationMatches.findByUserId(userId, {
      limit: limit + 1,
      offset,
    });

    const hasMore = docs.length > limit;
    const itemsToReturn = hasMore ? docs.slice(0, limit) : docs;

    const historyItems: NotificationHistoryItem[] = itemsToReturn
      .filter((doc) => {
        const hasId = typeof doc._id === "string" && doc._id !== "";
        const hasMessageId = typeof doc.messageId === "string" && doc.messageId !== "";
        const hasInterestId = typeof doc.interestId === "string" && doc.interestId !== "";
        return hasId && hasMessageId && hasInterestId;
      })
      .map((doc) => {
      const notifiedAt = toRequiredISOString(doc.notifiedAt, "notifiedAt");
      const rawSnapshot = doc.messageSnapshot;
      const snapshotText =
        typeof rawSnapshot === "object" &&
        rawSnapshot !== null &&
        "text" in rawSnapshot &&
        typeof rawSnapshot.text === "string"
          ? rawSnapshot.text
          : "";
      const snapshotCreatedAt =
        typeof rawSnapshot === "object" &&
        rawSnapshot !== null &&
        "createdAt" in rawSnapshot
          ? rawSnapshot.createdAt
          : undefined;

      // Calculate successful devices count from raw DB array
      const rawDeviceNotifications = Array.isArray(doc.deviceNotifications)
        ? doc.deviceNotifications
        : [];
      const successfulDevicesCount = rawDeviceNotifications.filter(
        (d: unknown) =>
          typeof d === "object" && d !== null && "success" in d && d.success === true,
      ).length;

      return {
        id: typeof doc._id === "string" ? doc._id : "",
        messageId: typeof doc.messageId === "string" ? doc.messageId : "",
        messageSnapshot: {
          text: snapshotText,
          createdAt:
            toOptionalISOString(
              snapshotCreatedAt,
              "messageSnapshot.createdAt",
            ) ?? notifiedAt,
        },
        notifiedAt,
        distance: typeof doc.distance === "number" ? doc.distance : 0,
        interestId: typeof doc.interestId === "string" ? doc.interestId : "",
        successfulDevicesCount,
        readAt: toOptionalISOString(doc.readAt, "readAt"),
      };
    });

    return NextResponse.json({
      items: historyItems,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    });
  } catch (error) {
    console.error("Error fetching notification history:", error);
    return NextResponse.json(
      { error: "Failed to fetch notification history" },
      { status: 500 },
    );
  }
}
