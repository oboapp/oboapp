import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

type RecordData = Record<string, unknown>;

let interestsStore: RecordData[] = [];
let subscriptionsStore: RecordData[] = [];
let sequence = 0;
let failAtInsertCallNumber: number | null = null;
let insertCallCounter = 0;
let failOnStatsLookup = false;

const {
  verifyAuthTokenMock,
  interestsFindByUserIdMock,
  subscriptionsFindByUserIdMock,
} = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  interestsFindByUserIdMock: vi.fn(),
  subscriptionsFindByUserIdMock: vi.fn(),
}));

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function getInterestsForUser(userId: string): RecordData[] {
  return interestsStore.filter((record) => record.userId === userId);
}

function getSubscriptionsForUser(userId: string): RecordData[] {
  return subscriptionsStore.filter((record) => record.userId === userId);
}

vi.mock("@/lib/verifyAuthToken", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    client: {
      batchWrite: vi.fn(
        async (
          operations: Array<{
            type: "set" | "delete";
            collection: string;
            id: string;
            data?: Record<string, unknown>;
          }>,
        ) => {
          for (const operation of operations) {
            if (operation.type === "delete") {
              if (operation.collection === "interests") {
                interestsStore = interestsStore.filter(
                  (record) => record._id !== operation.id,
                );
              } else if (operation.collection === "notificationSubscriptions") {
                subscriptionsStore = subscriptionsStore.filter(
                  (record) => record._id !== operation.id,
                );
              }

              continue;
            }

            insertCallCounter += 1;
            if (
              failAtInsertCallNumber !== null &&
              insertCallCounter === failAtInsertCallNumber
            ) {
              throw new Error("simulated insert failure");
            }

            const record = { _id: operation.id, ...(operation.data ?? {}) };
            if (operation.collection === "interests") {
              interestsStore.push(record);
            } else if (operation.collection === "notificationSubscriptions") {
              subscriptionsStore.push(record);
            }
          }
        },
      ),
    },
    interests: {
      findByUserId: interestsFindByUserIdMock,
      insertOne: vi.fn(async (data: RecordData) => {
        insertCallCounter += 1;
        if (
          failAtInsertCallNumber !== null &&
          insertCallCounter === failAtInsertCallNumber
        ) {
          throw new Error("simulated insert failure");
        }
        const id = nextId("interest");
        interestsStore.push({ _id: id, ...data });
        return id;
      }),
      deleteAllByUserId: vi.fn(async (userId: string) => {
        const before = interestsStore.length;
        interestsStore = interestsStore.filter(
          (record) => record.userId !== userId,
        );
        return before - interestsStore.length;
      }),
    },
    notificationSubscriptions: {
      findByUserId: subscriptionsFindByUserIdMock,
      insertOne: vi.fn(async (data: RecordData) => {
        insertCallCounter += 1;
        if (
          failAtInsertCallNumber !== null &&
          insertCallCounter === failAtInsertCallNumber
        ) {
          throw new Error("simulated insert failure");
        }
        const id = nextId("subscription");
        subscriptionsStore.push({ _id: id, ...data });
        return id;
      }),
      deleteAllByUserId: vi.fn(async (userId: string) => {
        const before = subscriptionsStore.length;
        subscriptionsStore = subscriptionsStore.filter(
          (record) => record.userId !== userId,
        );
        return before - subscriptionsStore.length;
      }),
    },
  }),
}));

function makeRequest(
  method: "GET" | "POST",
  body?: unknown,
  query = "",
  includeGuestProof = true,
): Request {
  return new Request(`http://localhost/api/auth/upgrade${query}`, {
    method,
    headers: {
      authorization: "Bearer token",
      ...(includeGuestProof ? { "x-guest-token": "guest-token-proof" } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function simplifyInterests(records: RecordData[]): Array<{
  id: string;
  userId: string;
  coordinates: RecordData;
  radius: unknown;
  label: unknown;
}> {
  return records
    .map((record) => ({
      id: String(record._id ?? ""),
      userId: record.userId as string,
      coordinates: record.coordinates as RecordData,
      radius: record.radius,
      label: record.label,
    }))
    .sort((a, b) =>
      `${a.userId}:${String(a.label)}`.localeCompare(
        `${b.userId}:${String(b.label)}`,
      ),
    );
}

function simplifySubscriptions(records: RecordData[]): Array<{
  id: string;
  userId: string;
  token: string;
  endpoint: unknown;
}> {
  return records
    .map((record) => ({
      id: String(record._id ?? ""),
      userId: record.userId as string,
      token: record.token as string,
      endpoint: record.endpoint,
    }))
    .sort((a, b) =>
      `${a.userId}:${a.token}`.localeCompare(`${b.userId}:${b.token}`),
    );
}

describe("/api/auth/upgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interestsFindByUserIdMock.mockImplementation(async (userId: string) => {
      if (failOnStatsLookup) {
        throw new Error("stats lookup should not run");
      }

      return getInterestsForUser(userId);
    });
    subscriptionsFindByUserIdMock.mockImplementation(async (userId: string) => {
      if (failOnStatsLookup) {
        throw new Error("stats lookup should not run");
      }

      return getSubscriptionsForUser(userId);
    });
    verifyAuthTokenMock.mockImplementation(
      async (authHeader: string | null) => {
        if (authHeader === "Bearer token") {
          return { userId: "account-user" };
        }

        if (authHeader === "Bearer guest-token-proof") {
          return { userId: "guest-user" };
        }

        throw new Error("Invalid auth token");
      },
    );
    interestsStore = [
      {
        _id: "g-interest-1",
        userId: "guest-user",
        coordinates: { lat: 42.7, lng: 23.3 },
        radius: 400,
        label: "Гост зона",
        color: "blue",
        createdAt: new Date("2026-03-01T10:00:00.000Z"),
        updatedAt: new Date("2026-03-01T10:00:00.000Z"),
      },
      {
        _id: "a-interest-1",
        userId: "account-user",
        coordinates: { lat: 42.71, lng: 23.31 },
        radius: 500,
        label: "Акаунт зона",
        color: "red",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
        updatedAt: new Date("2026-03-02T10:00:00.000Z"),
      },
    ];

    subscriptionsStore = [
      {
        _id: "g-sub-1",
        userId: "guest-user",
        token: "guest-token",
        endpoint: "https://fcm.example/guest",
        createdAt: new Date("2026-03-01T10:00:00.000Z"),
        updatedAt: new Date("2026-03-01T10:00:00.000Z"),
      },
      {
        _id: "a-sub-1",
        userId: "account-user",
        token: "account-token",
        endpoint: "https://fcm.example/account",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
        updatedAt: new Date("2026-03-02T10:00:00.000Z"),
      },
    ];

    failAtInsertCallNumber = null;
    insertCallCounter = 0;
    sequence = 100;
    failOnStatsLookup = false;
  });

  it("GET returns requiresDecision=true when both guest and account have data", async () => {
    const response = await GET(
      makeRequest("GET", undefined, "?guestUserId=guest-user") as any,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.requiresDecision).toBe(true);
    expect(data.hasGuestData).toBe(true);
    expect(data.hasAccountData).toBe(true);
  });

  it("POST keepSeparate does not mutate data", async () => {
    const beforeInterests = simplifyInterests(interestsStore);
    const beforeSubscriptions = simplifySubscriptions(subscriptionsStore);

    const response = await POST(
      makeRequest("POST", {
        guestUserId: "guest-user",
        option: "keepSeparate",
      }) as any,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      changed: false,
      option: "keepSeparate",
    });
    expect(simplifyInterests(interestsStore)).toEqual(beforeInterests);
    expect(simplifySubscriptions(subscriptionsStore)).toEqual(
      beforeSubscriptions,
    );
  });

  it("POST import moves guest data into account and clears guest records", async () => {
    const response = await POST(
      makeRequest("POST", {
        guestUserId: "guest-user",
        option: "import",
      }) as any,
    );

    expect(response.status).toBe(200);

    const guestInterestsAfter = interestsStore.filter(
      (record) => record.userId === "guest-user",
    );
    const guestSubscriptionsAfter = subscriptionsStore.filter(
      (record) => record.userId === "guest-user",
    );

    expect(guestInterestsAfter).toHaveLength(0);
    expect(guestSubscriptionsAfter).toHaveLength(0);

    const accountInterestsAfter = interestsStore.filter(
      (record) => record.userId === "account-user",
    );
    const accountSubscriptionsAfter = subscriptionsStore.filter(
      (record) => record.userId === "account-user",
    );

    expect(accountInterestsAfter).toHaveLength(2);
    expect(accountSubscriptionsAfter).toHaveLength(2);
    expect(
      accountInterestsAfter.some((record) => record.label === "Гост зона"),
    ).toBe(true);
    expect(
      accountSubscriptionsAfter.some(
        (record) => record.token === "guest-token",
      ),
    ).toBe(true);
  });

  it("POST replace keeps only guest data in account and clears guest records", async () => {
    const response = await POST(
      makeRequest("POST", {
        guestUserId: "guest-user",
        option: "replace",
      }) as any,
    );

    expect(response.status).toBe(200);

    const accountInterestsAfter = interestsStore.filter(
      (record) => record.userId === "account-user",
    );
    const accountSubscriptionsAfter = subscriptionsStore.filter(
      (record) => record.userId === "account-user",
    );

    expect(accountInterestsAfter).toHaveLength(1);
    expect(accountInterestsAfter[0].label).toBe("Гост зона");
    expect(accountSubscriptionsAfter).toHaveLength(1);
    expect(accountSubscriptionsAfter[0].token).toBe("guest-token");

    expect(
      interestsStore.filter((record) => record.userId === "guest-user"),
    ).toHaveLength(0);
    expect(
      subscriptionsStore.filter((record) => record.userId === "guest-user"),
    ).toHaveLength(0);
  });

  it("rolls back to previous state when upgrade mutation fails", async () => {
    const beforeInterests = simplifyInterests(interestsStore);
    const beforeSubscriptions = simplifySubscriptions(subscriptionsStore);

    failAtInsertCallNumber = 1;

    const response = await POST(
      makeRequest("POST", {
        guestUserId: "guest-user",
        option: "replace",
      }) as any,
    );

    expect(response.status).toBe(500);
    expect(simplifyInterests(interestsStore)).toEqual(beforeInterests);
    expect(simplifySubscriptions(subscriptionsStore)).toEqual(
      beforeSubscriptions,
    );

    expect(
      interestsStore
        .map((record) => String(record._id))
        .sort(compareStrings),
    ).toStrictEqual(["a-interest-1", "g-interest-1"]);
    expect(
      subscriptionsStore
        .map((record) => String(record._id))
        .sort(compareStrings),
    ).toStrictEqual(["a-sub-1", "g-sub-1"]);
  });

  it("returns 400 for invalid upgrade option", async () => {
    const response = await POST(
      makeRequest("POST", {
        guestUserId: "guest-user",
        option: "invalid",
      }) as any,
    );

    expect(response.status).toBe(400);
  });

  it("returns 401 for missing auth token", async () => {
    verifyAuthTokenMock.mockRejectedValueOnce(new Error("Missing auth token"));

    const response = await GET(
      makeRequest("GET", undefined, "?guestUserId=guest-user") as any,
    );

    expect(response.status).toBe(401);
  });

  it("returns 401 when guest proof token is missing", async () => {
    failOnStatsLookup = true;

    const response = await GET(
      makeRequest("GET", undefined, "?guestUserId=guest-user", false) as any,
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for GET when guest proof token does not match guestUserId", async () => {
    failOnStatsLookup = true;

    verifyAuthTokenMock.mockImplementation(
      async (authHeader: string | null) => {
        if (authHeader === "Bearer token") {
          return { userId: "account-user" };
        }

        if (authHeader === "Bearer guest-token-proof") {
          return { userId: "another-guest-user" };
        }

        throw new Error("Invalid auth token");
      },
    );

    const response = await GET(
      makeRequest("GET", undefined, "?guestUserId=guest-user") as any,
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 when guest proof token does not match guestUserId", async () => {
    verifyAuthTokenMock.mockImplementation(
      async (authHeader: string | null) => {
        if (authHeader === "Bearer token") {
          return { userId: "account-user" };
        }

        if (authHeader === "Bearer guest-token-proof") {
          return { userId: "another-guest-user" };
        }

        throw new Error("Invalid auth token");
      },
    );

    const response = await POST(
      makeRequest("POST", {
        guestUserId: "guest-user",
        option: "import",
      }) as any,
    );

    expect(response.status).toBe(403);
  });
});
