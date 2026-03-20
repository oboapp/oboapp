import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Interest } from "@/lib/types";
import { verifyAuthToken } from "@/lib/verifyAuthToken";
import { toRequiredISOString } from "@/lib/date-serialization";
import { sanitizeZoneColor, sanitizeZoneLabel } from "@/lib/zoneTypes";

// Constants
const MIN_RADIUS = 100; // meters
const MAX_RADIUS = 1000; // meters
const DEFAULT_RADIUS = 500; // meters

// Helper to validate radius
function validateRadius(radius: number): number {
  if (typeof radius !== "number" || Number.isNaN(radius)) {
    return DEFAULT_RADIUS;
  }
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
}

function applyCoordinatesUpdate(
  updates: Record<string, unknown>,
  coordinates: unknown,
): NextResponse | null {
  // No coordinates provided — not an error, just no update
  if (coordinates === undefined) {
    return null;
  }

  if (
    typeof coordinates !== "object" ||
    coordinates === null ||
    !("lat" in coordinates) ||
    !("lng" in coordinates)
  ) {
    return NextResponse.json({ error: "Invalid coordinates: must be an object with lat and lng" }, { status: 400 });
  }

  const coords = coordinates;
  if (typeof coords.lat !== "number" || typeof coords.lng !== "number") {
    return NextResponse.json({ error: "Invalid coordinates: lat and lng must be numbers" }, { status: 400 });
  }

  updates.coordinates = {
    lat: coords.lat,
    lng: coords.lng,
  };
  return null;
}

function applyRadiusUpdate(
  updates: Record<string, unknown>,
  radius: unknown,
): void {
  if (radius === undefined) {
    return;
  }

  updates.radius = validateRadius(typeof radius === "number" ? radius : DEFAULT_RADIUS);
}

function applyMetadataUpdates(
  updates: Record<string, unknown>,
  metadata: { label?: unknown; color?: unknown },
): void {
  if (typeof metadata.label === "string") {
    const sanitizedLabel = sanitizeZoneLabel(metadata.label);
    if (sanitizedLabel) {
      updates.label = sanitizedLabel;
    }
  }

  if (typeof metadata.color === "string") {
    const sanitizedColor = sanitizeZoneColor(metadata.color);
    if (sanitizedColor) {
      updates.color = sanitizedColor;
    }
  }
}

function recordToInterest(record: Record<string, unknown>): Interest | null {
  const coords =
    typeof record.coordinates === "object" &&
    record.coordinates !== null &&
    "lat" in record.coordinates &&
    "lng" in record.coordinates
      ? record.coordinates
      : null;

  if (
    !coords ||
    typeof coords.lat !== "number" ||
    typeof coords.lng !== "number"
  ) {
    console.warn(
      "[recordToInterest] Skipping interest with missing/invalid coordinates:",
      { interestId: record._id, userId: record.userId },
    );
    return null;
  }

  return {
    id: typeof record._id === "string" ? record._id : undefined,
    userId: typeof record.userId === "string" ? record.userId : "",
    coordinates: {
      lat: coords.lat,
      lng: coords.lng,
    },
    radius: typeof record.radius === "number" ? record.radius : DEFAULT_RADIUS,
    label: typeof record.label === "string" ? record.label : undefined,
    color: typeof record.color === "string" ? record.color : undefined,
    createdAt: toRequiredISOString(record.createdAt, "createdAt"),
    updatedAt: toRequiredISOString(record.updatedAt, "updatedAt"),
  };
}

function safeRecordToInterest(
  record: Record<string, unknown>,
): Interest | null {
  try {
    return recordToInterest(record);
  } catch (error) {
    console.error("[GET /api/interests] Skipping malformed interest record:", {
      interestId: record._id,
      userId: record.userId,
      error,
    });
    return null;
  }
}

async function findInterestsForUser(
  userId: string,
): Promise<Record<string, unknown>[]> {
  const db = await getDb();

  try {
    return await db.interests.findByUserId(userId);
  } catch (error) {
    console.error(
      "[GET /api/interests] Indexed interests query failed, falling back to userId-only query:",
      {
        userId,
        error,
      },
    );

    return db.interests.findMany({
      where: [{ field: "userId", op: "==", value: userId }],
    });
  }
}

// GET - Fetch all interests for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const docs = await findInterestsForUser(userId);

    const interests: Interest[] = docs
      .map(safeRecordToInterest)
      .filter((interest): interest is Interest => interest !== null);

    // Sort in JavaScript (findByUserId already orders by createdAt desc,
    // but we sort again defensively)
    interests.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA; // descending
    });

    return NextResponse.json({ interests });
  } catch (error) {
    console.error("[GET /api/interests] Error:", error);

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
      { error: "Failed to fetch interests" },
      { status: 500 },
    );
  }
}

// POST - Create a new interest
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const body = await request.json();
    const { coordinates, radius, label, color } = body;

    // Validate coordinates
    if (
      !coordinates ||
      typeof coordinates.lat !== "number" ||
      typeof coordinates.lng !== "number"
    ) {
      return NextResponse.json(
        { error: "Invalid coordinates" },
        { status: 400 },
      );
    }

    // Validate and sanitize radius
    const validatedRadius = validateRadius(radius);
    const sanitizedLabel = sanitizeZoneLabel(label);
    const sanitizedColor = sanitizeZoneColor(color);

    const now = new Date();
    const interestData: Record<string, unknown> = {
      userId,
      coordinates: {
        lat: coordinates.lat,
        lng: coordinates.lng,
      },
      radius: validatedRadius,
      createdAt: now,
      updatedAt: now,
    };

    if (sanitizedLabel) {
      interestData.label = sanitizedLabel;
    }
    if (sanitizedColor) {
      interestData.color = sanitizedColor;
    }

    const db = await getDb();
    const docId = await db.interests.insertOne(interestData);

    const newInterest: Interest = {
      id: docId,
      userId,
      coordinates: { lat: coordinates.lat, lng: coordinates.lng },
      radius: validatedRadius,
      ...(sanitizedLabel ? { label: sanitizedLabel } : {}),
      ...(sanitizedColor ? { color: sanitizedColor } : {}),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    return NextResponse.json({ interest: newInterest }, { status: 201 });
  } catch (error) {
    console.error("Error creating interest:", error);

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
      { error: "Failed to create interest" },
      { status: 500 },
    );
  }
}

// DELETE - Delete an interest by ID
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const { searchParams } = new URL(request.url);
    const interestId = searchParams.get("id");

    if (!interestId) {
      return NextResponse.json(
        { error: "Interest ID is required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const doc = await db.interests.findById(interestId);

    if (!doc) {
      return NextResponse.json(
        { error: "Interest not found" },
        { status: 404 },
      );
    }

    if (doc.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - You can only delete your own interests" },
        { status: 403 },
      );
    }

    await db.interests.deleteOne(interestId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting interest:", error);

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
      { error: "Failed to delete interest" },
      { status: 500 },
    );
  }
}

// PATCH - Update an interest (move or change radius)
export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId } = await verifyAuthToken(authHeader);

    const body = await request.json();
    const { id, coordinates, radius } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Interest ID is required" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const doc = await db.interests.findById(id);

    if (!doc) {
      return NextResponse.json(
        { error: "Interest not found" },
        { status: 404 },
      );
    }

    if (doc.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - You can only update your own interests" },
        { status: 403 },
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    const coordinatesError = applyCoordinatesUpdate(updates, coordinates);
    if (coordinatesError) {
      return coordinatesError;
    }

    applyRadiusUpdate(updates, radius);
    applyMetadataUpdates(updates, { label: body.label, color: body.color });

    await db.interests.updateOne(id, updates);

    // Fetch updated document
    const updatedDoc = await db.interests.findById(id);

    const updatedInterest = updatedDoc ? recordToInterest(updatedDoc) : null;
    if (!updatedInterest) {
      return NextResponse.json(
        { error: "Failed to read updated interest" },
        { status: 500 },
      );
    }

    return NextResponse.json({ interest: updatedInterest });
  } catch (error) {
    console.error("Error updating interest:", error);

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
      { error: "Failed to update interest" },
      { status: 500 },
    );
  }
}
