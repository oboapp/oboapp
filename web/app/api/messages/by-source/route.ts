import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordToInternalMessage } from "@/lib/doc-to-message";

const DEFAULT_RELEVANCE_DAYS = 7;

export async function GET(request: Request) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId");
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 12;

    if (!sourceId) {
      return NextResponse.json(
        { error: "sourceId parameter is required" },
        { status: 400 },
      );
    }

    // Get relevance period from environment
    const relevanceDays = process.env.MESSAGE_RELEVANCE_DAYS
      ? Number.parseInt(process.env.MESSAGE_RELEVANCE_DAYS, 10)
      : DEFAULT_RELEVANCE_DAYS;

    // Calculate cutoff date for timespan filtering
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - relevanceDays);

    const db = await getDb();
    const docs = await db.messages.findMany({
      where: [
        { field: "source", op: "==", value: sourceId },
        { field: "timespanEnd", op: ">=", value: cutoffDate },
      ],
      orderBy: [{ field: "timespanEnd", direction: "desc" }],
      limit,
    });

    const messages = docs.map(recordToInternalMessage);

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Error fetching messages by source:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
}
