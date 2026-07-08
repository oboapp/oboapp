import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { WhereClause, OrderByClause } from "@oboapp/db";
import {
  toRequiredISOString,
  toOptionalISOString,
} from "@/lib/date-serialization";
import {
  getBusStops,
  getCadastralProperties,
  getCategories,
  getFeatureCollection,
  getPins,
  getStreets,
} from "@/lib/typed-arrays";
import { getLocality } from "@/lib/bounds-utils";
import type { Event } from "@oboapp/shared";

const PAGE_SIZE = 20;
const DEFAULT_RELEVANCE_DAYS = 3;
const DEFAULT_EVENTS_CACHE_CONTROL =
  "public, s-maxage=300, stale-while-revalidate=600";

function getCutoffDate(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DEFAULT_RELEVANCE_DAYS);
  return cutoff;
}

function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function getBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function recordToEvent(record: Record<string, unknown>): Event {
  return {
    id: getOptionalString(record._id),
    plainText: getString(record.plainText),
    markdownText: getOptionalString(record.markdownText),
    geoJson: getFeatureCollection(record.geoJson),
    geometryQuality: getNumber(record.geometryQuality, 0),
    timespanStart: toOptionalISOString(record.timespanStart, "timespanStart"),
    timespanEnd: toOptionalISOString(record.timespanEnd, "timespanEnd"),
    categories: getCategories(record.categories),
    pins: getPins(record.pins),
    streets: getStreets(record.streets),
    cadastralProperties: getCadastralProperties(record.cadastralProperties),
    busStops: getBusStops(record.busStops),
    sources: getStringArray(record.sources),
    messageCount: getNumber(record.messageCount, 1),
    confidence: getNumber(record.confidence, 0),
    locality: getString(record.locality),
    cityWide: getBoolean(record.cityWide, false),
    createdAt: toRequiredISOString(record.createdAt, "createdAt"),
    updatedAt: toRequiredISOString(record.updatedAt, "updatedAt"),
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursorUpdatedAt = searchParams.get("cursorUpdatedAt");
    const cursorId = searchParams.get("cursorId");
    const shouldApplyDefaultCache = !cursorUpdatedAt && !cursorId;

    if ((cursorUpdatedAt && !cursorId) || (!cursorUpdatedAt && cursorId)) {
      return NextResponse.json(
        {
          error: "Both cursorUpdatedAt and cursorId must be provided together",
        },
        { status: 400 },
      );
    }

    const db = await getDb();
    const locality = getLocality();
    const cutoffDate = getCutoffDate();

    const where: WhereClause[] = [
      { field: "locality", op: "==", value: locality },
      { field: "updatedAt", op: ">=", value: cutoffDate.toISOString() },
    ];

    if (cursorUpdatedAt) {
      const parsed = new Date(cursorUpdatedAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "Invalid cursorUpdatedAt parameter" },
          { status: 400 },
        );
      }
    }

    const orderBy: OrderByClause[] = [
      { field: "updatedAt", direction: "desc" },
    ];

    const fetchedDocs = await db.events.findMany({
      where,
      orderBy,
      limit: PAGE_SIZE + 1,
    });

    // Apply cursor filtering in memory (Firestore supports one range filter)
    let filtered = fetchedDocs;
    if (cursorUpdatedAt && cursorId) {
      const cursorTime = new Date(cursorUpdatedAt).getTime();
      filtered = fetchedDocs.filter((doc) => {
        const docTime = new Date(
          toRequiredISOString(doc.updatedAt, "updatedAt"),
        ).getTime();
        if (docTime < cursorTime) return true;
        if (docTime > cursorTime) return false;
        return String(doc._id).localeCompare(cursorId) < 0;
      });
    }

    const hasMore = filtered.length > PAGE_SIZE;
    const pageDocs = filtered.slice(0, PAGE_SIZE);
    const events = pageDocs.map(recordToEvent);

    const lastDoc = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && lastDoc
        ? {
            updatedAt: toRequiredISOString(lastDoc.updatedAt, "updatedAt"),
            id: String(lastDoc._id),
          }
        : undefined;

    if (shouldApplyDefaultCache) {
      return NextResponse.json(
        { events, nextCursor },
        {
          headers: {
            "Cache-Control": DEFAULT_EVENTS_CACHE_CONTROL,
          },
        },
      );
    }

    return NextResponse.json({ events, nextCursor });
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 },
    );
  }
}
