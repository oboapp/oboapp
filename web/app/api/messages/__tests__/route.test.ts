import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";

// Mock data store — tests set this before each test
let mockMessagesData: Record<string, unknown>[] = [];

// Mock sources so source-validation in validateSources() is independent of the
// upstream SOURCES assembly (which may be a minimal demo set).
vi.mock("@/lib/sources", () => ({
  default: [
    { id: "sofia-bg", url: "https://sofia.bg", name: "Столична община", localities: ["bg.sofia"] },
    { id: "toplo-bg", url: "https://toplo.bg", name: "Топлофикация", localities: ["bg.sofia"] },
    { id: "erm-zapad", url: "https://erm.bg", name: "ЧЕЗ Разпределение", localities: ["bg.sofia"] },
  ],
}));

// Mock the db module (replaces the old firebase-admin mock)
vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockImplementation(async () => ({
    messages: {
      findMany: vi.fn().mockImplementation(async (options?: any) => {
        let filtered = [...mockMessagesData];

        if (options?.where) {
          for (const clause of options.where) {
            filtered = filtered.filter((doc) => {
              const fieldValue = doc[clause.field];

              switch (clause.op) {
                case ">=":
                  if (fieldValue == null) return false;
                  return fieldValue >= clause.value;
                case "==":
                  return fieldValue === clause.value;
                case "in":
                  return (
                    Array.isArray(clause.value) &&
                    clause.value.includes(fieldValue)
                  );
                case "array-contains-any":
                  return (
                    Array.isArray(fieldValue) &&
                    clause.value.some((v: any) =>
                      (fieldValue as unknown[]).includes(v),
                    )
                  );
                case "not-in":
                  return (
                    Array.isArray(clause.value) &&
                    !clause.value.includes(fieldValue)
                  );
                default:
                  return true;
              }
            });
          }
        }

        if (options?.orderBy && Array.isArray(options.orderBy)) {
          filtered.sort((a, b) => {
            for (const order of options.orderBy) {
              const aValue = a[order.field];
              const bValue = b[order.field];

              if (aValue === bValue) continue;

              const aTime =
                aValue instanceof Date
                  ? aValue.getTime()
                  : typeof aValue === "string"
                    ? new Date(aValue).getTime()
                    : null;
              const bTime =
                bValue instanceof Date
                  ? bValue.getTime()
                  : typeof bValue === "string"
                    ? new Date(bValue).getTime()
                    : null;

              if (aTime !== null && bTime !== null) {
                return order.direction === "desc"
                  ? bTime - aTime
                  : aTime - bTime;
              }

              const aString = String(aValue ?? "");
              const bString = String(bValue ?? "");
              const compare = aString.localeCompare(bString);
              return order.direction === "desc" ? -compare : compare;
            }

            return 0;
          });
        }

        return filtered;
      }),
    },
  })),
}));

// Mock the messageIngest module
vi.mock("@/lib/messageIngest", () => ({
  verifyAuthToken: vi.fn(),
  validateMessageText: vi.fn(),
  messageIngest: vi.fn(),
}));

// Helper to create mock GeoJSON for testing
const createMockGeoJson = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [23.3394, 42.7035],
      },
      properties: {},
    },
  ],
});

describe("GET /api/messages - Query Parameter Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject non-numeric coordinate values with 400", async () => {
    const mockRequest = new Request(
      "http://localhost/api/messages?north=invalid&south=42.6&east=23.4&west=23.3",
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid query parameters");
  });

  it("should reject invalid zoom values (too low) with 400", async () => {
    const mockRequest = new Request("http://localhost/api/messages?zoom=0");
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid query parameters");
  });

  it("should reject invalid zoom values (too high) with 400", async () => {
    const mockRequest = new Request("http://localhost/api/messages?zoom=23");
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid query parameters");
  });

  it("should reject non-numeric zoom values with 400", async () => {
    const mockRequest = new Request(
      "http://localhost/api/messages?zoom=invalid",
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid query parameters");
  });

  it("should reject invalid category names with 400", async () => {
    const mockRequest = new Request(
      "http://localhost/api/messages?categories=invalid-category,water",
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid query parameters");
  });

  it("should accept valid category names (water,electricity)", async () => {
    // This test just validates that valid category names don't cause a 400 error
    // The actual filtering logic is tested in other test suites
    const mockRequest = new Request(
      "http://localhost/api/messages?categories=water,electricity",
    );
    const { searchParams } = new URL(mockRequest.url);
    const { messagesQuerySchema } = await import("@/lib/api-query.schema");
    const parsed = messagesQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data?.categories).toEqual(["water", "electricity"]);
  });

  it("should accept 'uncategorized' as a special category value", async () => {
    // This test validates that 'uncategorized' is accepted as a valid value
    const mockRequest = new Request(
      "http://localhost/api/messages?categories=uncategorized",
    );
    const { searchParams } = new URL(mockRequest.url);
    const { messagesQuerySchema } = await import("@/lib/api-query.schema");
    const parsed = messagesQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data?.categories).toEqual(["uncategorized"]);
  });

  it("should accept up to 10 category values", async () => {
    const categories = Array.from({ length: 10 }, () => "water").join(",");
    const mockRequest = new Request(
      `http://localhost/api/messages?categories=${categories}`,
    );
    const { searchParams } = new URL(mockRequest.url);
    const { messagesQuerySchema } = await import("@/lib/api-query.schema");
    const parsed = messagesQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data?.categories).toHaveLength(10);
  });

  it("should reject more than 10 category values", async () => {
    const categories = Array.from({ length: 11 }, () => "water").join(",");
    const mockRequest = new Request(
      `http://localhost/api/messages?categories=${categories}`,
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid query parameters");
  });

  it("should accept valid coordinate bounds", async () => {
    // This test validates that valid coordinates are accepted by the schema
    const mockRequest = new Request(
      "http://localhost/api/messages?north=42.75&south=42.65&east=23.45&west=23.25&zoom=15",
    );
    const { searchParams } = new URL(mockRequest.url);
    const { messagesQuerySchema } = await import("@/lib/api-query.schema");
    const parsed = messagesQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data?.north).toBe(42.75);
    expect(parsed.data?.south).toBe(42.65);
    expect(parsed.data?.east).toBe(23.45);
    expect(parsed.data?.west).toBe(23.25);
    expect(parsed.data?.zoom).toBe(15);
  });

  it("should accept valid timespanEndGte ISO timestamp", async () => {
    const mockRequest = new Request(
      "http://localhost/api/messages?timespanEndGte=2026-02-23T00:00:00.000Z",
    );
    const { searchParams } = new URL(mockRequest.url);
    const { messagesQuerySchema } = await import("@/lib/api-query.schema");
    const parsed = messagesQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data?.timespanEndGte).toBeInstanceOf(Date);
  });
});

describe("GET /api/messages - Date Filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessagesData = [];
    // Reset environment variable
    delete process.env.MESSAGE_RELEVANCE_DAYS;
  });

  it("should filter out messages with all timespans expired", async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expiredDate = new Date("2024-01-01");

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Old disruption",
        geoJson: createMockGeoJson(),
        createdAt: expiredDate,
        timespanEnd: expiredDate,
      },
      {
        _id: "msg2",
        text: "Current disruption",
        geoJson: createMockGeoJson(),
        createdAt: yesterday,
        timespanEnd: tomorrow,
      },
    ];

    const mockRequest = new Request("http://localhost/api/messages");
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].id).toBe("msg2");
  });

  it("should show messages without timespans if they are within MESSAGE_RELEVANCE_DAYS", async () => {
    // Set relevance to 30 days
    process.env.MESSAGE_RELEVANCE_DAYS = "30";

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10); // 10 days ago

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Recent message without timespans",
        geoJson: createMockGeoJson(),
        createdAt: recentDate,
        timespanEnd: recentDate,
      },
      {
        _id: "msg2",
        text: "Old message without timespans",
        geoJson: createMockGeoJson(),
        createdAt: oldDate,
        timespanEnd: oldDate,
      },
    ];

    const mockRequest = new Request("http://localhost/api/messages");
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].id).toBe("msg1");
  });

  it("should show message if at least one timespan is still relevant", async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Mixed timespans",
        geoJson: createMockGeoJson(),
        createdAt: yesterday,
        timespanEnd: tomorrow, // MAX end time
      },
    ];

    const mockRequest = new Request("http://localhost/api/messages");
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].id).toBe("msg1");
  });

  it("should use default 7 days when MESSAGE_RELEVANCE_DAYS is not set", async () => {
    const date5DaysAgo = new Date();
    date5DaysAgo.setDate(date5DaysAgo.getDate() - 5);

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Message from 5 days ago",
        geoJson: createMockGeoJson(),
        createdAt: date5DaysAgo,
        timespanEnd: date5DaysAgo,
      },
    ];

    const mockRequest = new Request("http://localhost/api/messages");
    const response = await GET(mockRequest);
    const data = await response.json();

    // Should be included because it's within 7 days
    expect(data.messages).toHaveLength(1);
  });

  it("should return messages sorted by finalizedAt first, then timespanEnd", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneDayLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const twoDaysLater = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    mockMessagesData = [
      {
        _id: "msg-finalized-newest",
        text: "Newest by finalizedAt",
        geoJson: createMockGeoJson(),
        createdAt: twoHoursAgo,
        finalizedAt: now,
        timespanEnd: oneHourAgo,
      },
      {
        _id: "msg-finalized-middle",
        text: "Middle by finalizedAt",
        geoJson: createMockGeoJson(),
        createdAt: now,
        finalizedAt: oneHourAgo,
        timespanEnd: twoDaysLater,
      },
      {
        _id: "msg-no-finalized-latest-end",
        text: "No finalizedAt but latest timespanEnd",
        geoJson: createMockGeoJson(),
        createdAt: oneHourAgo,
        timespanEnd: oneDayLater,
      },
    ];

    const mockRequest = new Request("http://localhost/api/messages");
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(3);
    expect(data.messages.map((m: any) => m.id)).toEqual([
      "msg-finalized-newest",
      "msg-finalized-middle",
      "msg-no-finalized-latest-end",
    ]);
  });

  it("should use timespanEndGte query parameter as cutoff when provided", async () => {
    const now = new Date("2026-02-23T12:00:00.000Z");
    const todayStart = new Date("2026-02-23T00:00:00.000Z");
    const yesterday = new Date("2026-02-22T23:59:59.000Z");

    mockMessagesData = [
      {
        _id: "msg-yesterday",
        text: "Yesterday",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: yesterday,
      },
      {
        _id: "msg-today",
        text: "Today",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: todayStart,
      },
    ];

    const mockRequest = new Request(
      "http://localhost/api/messages?timespanEndGte=2026-02-23T00:00:00.000Z",
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].id).toBe("msg-today");
  });
});

describe("GET /api/messages - Source Filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessagesData = [];
    // Set locality for source validation
    process.env.NEXT_PUBLIC_LOCALITY = "bg.sofia";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_LOCALITY;
  });

  it("should filter messages by single source", async () => {
    const now = new Date();

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Message from sofia-bg",
        source: "sofia-bg",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
      {
        _id: "msg2",
        text: "Message from toplo-bg",
        source: "toplo-bg",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
    ];

    const mockRequest = new Request(
      "http://localhost/api/messages?sources=sofia-bg",
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].source).toBe("sofia-bg");
  });

  it("should filter messages by multiple sources", async () => {
    const now = new Date();

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Message from sofia-bg",
        source: "sofia-bg",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
      {
        _id: "msg2",
        text: "Message from toplo-bg",
        source: "toplo-bg",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
      {
        _id: "msg3",
        text: "Message from erm-zapad",
        source: "erm-zapad",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
    ];

    const mockRequest = new Request(
      "http://localhost/api/messages?sources=sofia-bg,toplo-bg",
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(2);
    const sources = data.messages.map((m: any) => m.source);
    expect(sources).toContain("sofia-bg");
    expect(sources).toContain("toplo-bg");
    expect(sources).not.toContain("erm-zapad");
  });

  it("should return all messages when source filter is empty (no filter)", async () => {
    const now = new Date();

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Message from sofia-bg",
        source: "sofia-bg",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
    ];

    const mockRequest = new Request("http://localhost/api/messages?sources=");
    const response = await GET(mockRequest);
    const data = await response.json();

    // Empty sources parameter should not filter - returns all messages
    expect(data.messages).toHaveLength(1);
  });

  it("should filter messages without source field when filtering by source", async () => {
    const now = new Date();

    mockMessagesData = [
      {
        _id: "msg1",
        text: "Message from sofia-bg",
        source: "sofia-bg",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
      {
        _id: "msg2",
        text: "Message without source",
        geoJson: createMockGeoJson(),
        createdAt: now,
        timespanEnd: now,
      },
    ];

    const mockRequest = new Request(
      "http://localhost/api/messages?sources=sofia-bg",
    );
    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].id).toBe("msg1");
  });
});
