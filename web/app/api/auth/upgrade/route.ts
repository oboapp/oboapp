import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuthToken } from "@/lib/verifyAuthToken";
import type { UpgradeDecisionOption } from "@/lib/auth-upgrade";

type DbRecord = Record<string, unknown>;

interface UpgradeStats {
  guestInterests: number;
  accountInterests: number;
  guestSubscriptions: number;
  accountSubscriptions: number;
}

type BatchOperation = {
  type: "set" | "delete";
  collection: string;
  id: string;
  data?: Record<string, unknown>;
};

const INTERESTS_COLLECTION = "interests";
const NOTIFICATION_SUBSCRIPTIONS_COLLECTION = "notificationSubscriptions";

function parseGuestUserId(request: NextRequest): string | null {
  const { searchParams } = new URL(request.url);
  return searchParams.get("guestUserId");
}

function parseGuestProofToken(request: NextRequest): string | null {
  const token = request.headers.get("x-guest-token");
  return token && token.trim().length > 0 ? token : null;
}

async function getUpgradeStats(
  guestUserId: string,
  accountUserId: string,
): Promise<UpgradeStats> {
  const db = await getDb();

  const [
    guestInterests,
    accountInterests,
    guestSubscriptions,
    accountSubscriptions,
  ] = await Promise.all([
    db.interests.findByUserId(guestUserId),
    db.interests.findByUserId(accountUserId),
    db.notificationSubscriptions.findByUserId(guestUserId),
    db.notificationSubscriptions.findByUserId(accountUserId),
  ]);

  return {
    guestInterests: guestInterests.length,
    accountInterests: accountInterests.length,
    guestSubscriptions: guestSubscriptions.length,
    accountSubscriptions: accountSubscriptions.length,
  };
}

function getInterestKey(record: Record<string, unknown>): string {
  const coordinates =
    typeof record.coordinates === "object" &&
    record.coordinates !== null &&
    "lat" in record.coordinates &&
    "lng" in record.coordinates
      ? record.coordinates
      : { lat: "", lng: "" };
  const lat =
    "lat" in coordinates && typeof coordinates.lat === "number"
      ? coordinates.lat
      : "";
  const lng =
    "lng" in coordinates && typeof coordinates.lng === "number"
      ? coordinates.lng
      : "";
  const radius = typeof record.radius === "number" ? record.radius : "";
  const label = typeof record.label === "string" ? record.label : "";
  const color = typeof record.color === "string" ? record.color : "";
  return `${lat}:${lng}:${radius}:${label}:${color}`;
}

function isUpgradeOption(value: unknown): value is UpgradeDecisionOption {
  return value === "import" || value === "keepSeparate" || value === "replace";
}

function getRecordId(record: DbRecord): string | null {
  const id = record._id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function buildInterestPayload(record: DbRecord, userId: string): DbRecord | null {
  const coords = record.coordinates;
  if (
    typeof coords !== "object" ||
    coords === null ||
    !("lat" in coords) ||
    !("lng" in coords) ||
    typeof coords.lat !== "number" ||
    typeof coords.lng !== "number"
  ) {
    console.warn("Skipping interest with invalid coordinates during upgrade:", record._id);
    return null;
  }

  return {
    userId,
    coordinates: { lat: coords.lat, lng: coords.lng },
    radius: typeof record.radius === "number" ? record.radius : 500,
    label: typeof record.label === "string" ? record.label : undefined,
    color: typeof record.color === "string" ? record.color : undefined,
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt : new Date(),
  };
}

function buildSubscriptionPayload(
  record: DbRecord,
  userId: string,
): DbRecord | null {
  const token = typeof record.token === "string" ? record.token : "";
  if (!token) {
    return null;
  }

  return {
    userId,
    token,
    endpoint: record.endpoint,
    deviceInfo: record.deviceInfo ?? {},
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt : new Date(),
  };
}

function createSetOperation(
  collection: string,
  data: DbRecord,
  id?: string,
): BatchOperation {
  return {
    type: "set",
    collection,
    id: id ?? globalThis.crypto.randomUUID(),
    data,
  };
}

function createDeleteOperation(collection: string, id: string): BatchOperation {
  return {
    type: "delete",
    collection,
    id,
  };
}

async function restoreUserState(
  userId: string,
  interestRecords: DbRecord[],
  subscriptionRecords: DbRecord[],
): Promise<void> {
  const db = await getDb();

  const [existingInterests, existingSubscriptions] = await Promise.all([
    db.interests.findByUserId(userId),
    db.notificationSubscriptions.findByUserId(userId),
  ]);

  const operations: BatchOperation[] = [];

  for (const existingInterest of existingInterests) {
    const id = getRecordId(existingInterest);
    if (id) {
      operations.push(createDeleteOperation(INTERESTS_COLLECTION, id));
    }
  }

  for (const existingSubscription of existingSubscriptions) {
    const id = getRecordId(existingSubscription);
    if (id) {
      operations.push(
        createDeleteOperation(NOTIFICATION_SUBSCRIPTIONS_COLLECTION, id),
      );
    }
  }

  for (const interestRecord of interestRecords) {
    const id = getRecordId(interestRecord);
    const payload = buildInterestPayload(interestRecord, userId);
    if (!payload) {
      continue;
    }
    operations.push(
      createSetOperation(
        INTERESTS_COLLECTION,
        payload,
        id ?? undefined,
      ),
    );
  }

  for (const subscriptionRecord of subscriptionRecords) {
    const id = getRecordId(subscriptionRecord);
    const payload = buildSubscriptionPayload(subscriptionRecord, userId);
    if (!payload) {
      continue;
    }

    operations.push(
      createSetOperation(
        NOTIFICATION_SUBSCRIPTIONS_COLLECTION,
        payload,
        id ?? undefined,
      ),
    );
  }

  if (operations.length > 0) {
    await db.client.batchWrite(operations);
  }
}

function isAuthTokenError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message === "Missing auth token" ||
      error.message === "Invalid auth token")
  );
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId: accountUserId } = await verifyAuthToken(authHeader);

    const guestUserId = parseGuestUserId(request);
    if (!guestUserId) {
      return NextResponse.json(
        { error: "guestUserId is required" },
        { status: 400 },
      );
    }

    if (guestUserId === accountUserId) {
      return NextResponse.json({
        requiresDecision: false,
        hasGuestData: false,
        hasAccountData: false,
      });
    }

    const guestProofToken = parseGuestProofToken(request);
    if (!guestProofToken) {
      return NextResponse.json(
        { error: "Missing guest proof token" },
        { status: 401 },
      );
    }

    const { userId: proofGuestUserId } = await verifyAuthToken(
      `Bearer ${guestProofToken}`,
    );
    if (proofGuestUserId !== guestUserId) {
      return NextResponse.json(
        { error: "Guest proof token does not match guestUserId" },
        { status: 403 },
      );
    }

    const stats = await getUpgradeStats(guestUserId, accountUserId);
    const hasGuestData = stats.guestInterests + stats.guestSubscriptions > 0;
    const hasAccountData =
      stats.accountInterests + stats.accountSubscriptions > 0;

    return NextResponse.json({
      requiresDecision: hasGuestData && hasAccountData,
      hasGuestData,
      hasAccountData,
      stats,
    });
  } catch (error) {
    if (isAuthTokenError(error)) {
      const message = error.message;
      return NextResponse.json(
        { error: `Unauthorized - ${message}` },
        { status: 401 },
      );
    }

    console.error("Error checking upgrade conflict:", error);
    return NextResponse.json(
      { error: "Failed to check upgrade conflict" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { userId: accountUserId } = await verifyAuthToken(authHeader);

    const body: {
      guestUserId?: string;
      option?: UpgradeDecisionOption;
    } = await request.json();

    const guestUserId = body.guestUserId;
    const option = body.option;

    if (!guestUserId) {
      return NextResponse.json(
        { error: "guestUserId is required" },
        { status: 400 },
      );
    }

    if (!isUpgradeOption(option)) {
      return NextResponse.json({ error: "Invalid option" }, { status: 400 });
    }

    if (guestUserId === accountUserId) {
      return NextResponse.json({ success: true, option, changed: false });
    }

    const guestProofToken = parseGuestProofToken(request);
    if (!guestProofToken) {
      return NextResponse.json(
        { error: "Missing guest proof token" },
        { status: 401 },
      );
    }

    const { userId: proofGuestUserId } = await verifyAuthToken(
      `Bearer ${guestProofToken}`,
    );
    if (proofGuestUserId !== guestUserId) {
      return NextResponse.json(
        { error: "Guest proof token does not match guestUserId" },
        { status: 403 },
      );
    }

    if (option === "keepSeparate") {
      return NextResponse.json({ success: true, option, changed: false });
    }

    const db = await getDb();

    const [
      guestInterests,
      accountInterests,
      guestSubscriptions,
      accountSubscriptions,
    ] = await Promise.all([
      db.interests.findByUserId(guestUserId),
      db.interests.findByUserId(accountUserId),
      db.notificationSubscriptions.findByUserId(guestUserId),
      db.notificationSubscriptions.findByUserId(accountUserId),
    ]);

    try {
      const operations: BatchOperation[] = [];

      if (option === "replace") {
        for (const accountInterest of accountInterests) {
          const id = getRecordId(accountInterest);
          if (id) {
            operations.push(createDeleteOperation(INTERESTS_COLLECTION, id));
          }
        }

        for (const accountSubscription of accountSubscriptions) {
          const id = getRecordId(accountSubscription);
          if (id) {
            operations.push(
              createDeleteOperation(NOTIFICATION_SUBSCRIPTIONS_COLLECTION, id),
            );
          }
        }

        for (const guestInterest of guestInterests) {
          const payload = buildInterestPayload(guestInterest, accountUserId);
          if (!payload) {
            continue;
          }
          operations.push(
            createSetOperation(INTERESTS_COLLECTION, {
              ...payload,
              updatedAt: new Date(),
            }),
          );
        }

        for (const guestSubscription of guestSubscriptions) {
          const payload = buildSubscriptionPayload(
            guestSubscription,
            accountUserId,
          );
          if (!payload) {
            continue;
          }

          operations.push(
            createSetOperation(NOTIFICATION_SUBSCRIPTIONS_COLLECTION, {
              ...payload,
              updatedAt: new Date(),
            }),
          );
        }
      } else {
        const accountInterestKeys = new Set(
          accountInterests.map(getInterestKey),
        );
        const accountSubscriptionTokens = new Set(
          accountSubscriptions.map((doc) =>
            typeof doc.token === "string" ? doc.token : "",
          ),
        );

        for (const guestInterest of guestInterests) {
          const key = getInterestKey(guestInterest);
          if (accountInterestKeys.has(key)) {
            continue;
          }

          const payload = buildInterestPayload(guestInterest, accountUserId);
          if (!payload) {
            continue;
          }

          operations.push(
            createSetOperation(INTERESTS_COLLECTION, {
              ...payload,
              updatedAt: new Date(),
            }),
          );

          accountInterestKeys.add(key);
        }

        for (const guestSubscription of guestSubscriptions) {
          const token =
            typeof guestSubscription.token === "string"
              ? guestSubscription.token
              : "";
          if (!token || accountSubscriptionTokens.has(token)) {
            continue;
          }

          const payload = buildSubscriptionPayload(
            guestSubscription,
            accountUserId,
          );
          if (!payload) {
            continue;
          }

          operations.push(
            createSetOperation(NOTIFICATION_SUBSCRIPTIONS_COLLECTION, {
              ...payload,
              updatedAt: new Date(),
            }),
          );

          accountSubscriptionTokens.add(token);
        }
      }

      for (const guestInterest of guestInterests) {
        const id = getRecordId(guestInterest);
        if (id) {
          operations.push(createDeleteOperation(INTERESTS_COLLECTION, id));
        }
      }

      for (const guestSubscription of guestSubscriptions) {
        const id = getRecordId(guestSubscription);
        if (id) {
          operations.push(
            createDeleteOperation(NOTIFICATION_SUBSCRIPTIONS_COLLECTION, id),
          );
        }
      }

      if (operations.length > 0) {
        await db.client.batchWrite(operations);
      }
    } catch (operationError) {
      console.error("Upgrade operation failed, restoring previous state", {
        operationError,
      });

      await Promise.all([
        restoreUserState(accountUserId, accountInterests, accountSubscriptions),
        restoreUserState(guestUserId, guestInterests, guestSubscriptions),
      ]);

      throw operationError;
    }

    return NextResponse.json({ success: true, option, changed: true });
  } catch (error) {
    if (isAuthTokenError(error)) {
      const message = error.message;
      return NextResponse.json(
        { error: `Unauthorized - ${message}` },
        { status: 401 },
      );
    }

    console.error("Error applying upgrade option:", error);
    return NextResponse.json(
      { error: "Failed to apply upgrade option" },
      { status: 500 },
    );
  }
}
