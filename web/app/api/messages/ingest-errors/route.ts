import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { WhereClause } from "@oboapp/db";
import { toRequiredISOString } from "@/lib/date-serialization";
import { recordToInternalMessage } from "../record-to-internal-message";
import { paginateCandidateDocs } from "../pagination-utils";

const PAGE_SIZE = 12;
const FETCH_LIMIT = 500;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursorFinalizedAt = searchParams.get("cursorFinalizedAt");
    const cursorId = searchParams.get("cursorId");

    if ((cursorFinalizedAt && !cursorId) || (!cursorFinalizedAt && cursorId)) {
      return NextResponse.json(
        {
          error:
            "Both cursorFinalizedAt and cursorId must be provided together",
        },
        { status: 400 },
      );
    }

    const db = await getDb();
    let currentCursorDate: Date | null = null;
    let currentCursorId: string | null = null;

    if (cursorFinalizedAt) {
      const parsedDate = new Date(cursorFinalizedAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid cursorFinalizedAt parameter" },
          { status: 400 },
        );
      }
      currentCursorDate = parsedDate;
      currentCursorId = cursorId;
    }

    const isGeoJsonMissing = (value: unknown): boolean => {
      if (value === null || value === undefined) {
        return true;
      }
      if (typeof value === "string") {
        return value.trim().length === 0;
      }
      // Check for empty FeatureCollection (object with no features)
      if (typeof value === "object" && value !== null) {
        const fc = value;
        const features = "features" in fc ? fc.features : undefined;
        if (!Array.isArray(features) || features.length === 0) return true;
      }
      return false;
    };

    const whereClause: WhereClause[] = [
      { field: "finalizedAt", op: ">", value: new Date(0) },
    ];

    if (currentCursorDate) {
      whereClause.push({
        field: "finalizedAt",
        op: "<=",
        value: currentCursorDate,
      });
    }

    const fetchedDocs = await db.messages.findMany({
      where: whereClause,
      orderBy: [{ field: "finalizedAt", direction: "desc" }],
      limit: FETCH_LIMIT,
    });

    const cursor = currentCursorDate
      ? { date: currentCursorDate, id: currentCursorId! }
      : null;

    const { pageDocs, boundaryDoc, hasMore } = paginateCandidateDocs(
      fetchedDocs,
      cursor,
      (doc) => {
        const hasGeoJsonField = Object.hasOwn(doc, "geoJson");
        return !hasGeoJsonField || isGeoJsonMissing(doc.geoJson);
      },
      PAGE_SIZE,
      FETCH_LIMIT,
    );

    const messages = pageDocs.map(recordToInternalMessage);
    const nextCursor =
      boundaryDoc && hasMore
        ? {
            finalizedAt: toRequiredISOString(
              boundaryDoc.finalizedAt,
              "finalizedAt",
            ),
            id: String(boundaryDoc._id),
          }
        : undefined;

    return NextResponse.json({ messages, nextCursor });
  } catch (error) {
    console.error("Error fetching ingest error messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch ingest error messages" },
      { status: 500 },
    );
  }
}
