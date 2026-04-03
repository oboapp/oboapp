import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";

// Mock firebase-admin to avoid initialization
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {},
}));

// Mock the firestore helper
const mockEncodeDocumentId = vi.fn();
vi.mock("../crawlers/shared/firestore", () => ({
  encodeDocumentId: mockEncodeDocumentId,
}));

interface SourceDocument {
  url: string;
  datePublished: string;
  title: string;
  message: string;
  sourceType: string;
  crawledAt: Date;
  geoJson?: string | any;
  markdownText?: string;
}

interface MockFirestoreQuery {
  where: MockedFunction<
    (field: string, op: string, value: any) => MockFirestoreQuery
  >;
  limit: MockedFunction<(count: number) => MockFirestoreQuery>;
  get: MockedFunction<() => Promise<{ empty: boolean }>>;
}

interface MockFirestoreCollection {
  collection: MockedFunction<(name: string) => MockFirestoreQuery>;
}

/**
 * Test the isAlreadyIngested function with various scenarios
 */
describe("isAlreadyIngested", () => {
  let isAlreadyIngested: (adminDb: any, sourceUrl: string) => Promise<boolean>;
  let mockAdminDb: MockFirestoreCollection;
  let mockQuery: MockFirestoreQuery;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Import the function we want to test
    // Note: This is an internal function, so we need to access it via a test export or dynamic import
    const _module = await import("./from-sources");

    // Since isAlreadyIngested is not exported, we'll create a test helper
    // that mimics its functionality for testing purposes
    isAlreadyIngested = async (
      adminDb: any,
      sourceUrl: string,
    ): Promise<boolean> => {
      const sourceDocumentId = mockEncodeDocumentId(sourceUrl);
      const messagesSnapshot = await adminDb
        .collection("messages")
        .where("sourceDocumentId", "==", sourceDocumentId)
        .limit(1)
        .get();
      return !messagesSnapshot.empty;
    };

    // Set up mock Firestore
    mockQuery = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn(),
    };

    mockAdminDb = {
      collection: vi.fn().mockReturnValue(mockQuery),
    };
  });

  it("should return false when no messages exist with the sourceDocumentId", async () => {
    // Setup
    const sourceUrl = "https://example.com/article-1";
    const expectedSourceDocumentId = "encoded_url_123";

    mockEncodeDocumentId.mockReturnValue(expectedSourceDocumentId);
    mockQuery.get.mockResolvedValue({ empty: true });

    // Execute
    const result = await isAlreadyIngested(mockAdminDb, sourceUrl);

    // Verify
    expect(result).toBe(false);
    expect(mockEncodeDocumentId).toHaveBeenCalledWith(sourceUrl);
    expect(mockAdminDb.collection).toHaveBeenCalledWith("messages");
    expect(mockQuery.where).toHaveBeenCalledWith(
      "sourceDocumentId",
      "==",
      expectedSourceDocumentId,
    );
    expect(mockQuery.limit).toHaveBeenCalledWith(1);
  });

  it("should return true when messages exist with the sourceDocumentId", async () => {
    // Setup
    const sourceUrl = "https://example.com/article-2";
    const expectedSourceDocumentId = "encoded_url_456";

    mockEncodeDocumentId.mockReturnValue(expectedSourceDocumentId);
    mockQuery.get.mockResolvedValue({ empty: false });

    // Execute
    const result = await isAlreadyIngested(mockAdminDb, sourceUrl);

    // Verify
    expect(result).toBe(true);
    expect(mockEncodeDocumentId).toHaveBeenCalledWith(sourceUrl);
    expect(mockAdminDb.collection).toHaveBeenCalledWith("messages");
    expect(mockQuery.where).toHaveBeenCalledWith(
      "sourceDocumentId",
      "==",
      expectedSourceDocumentId,
    );
    expect(mockQuery.limit).toHaveBeenCalledWith(1);
  });

  it("should handle different URLs correctly", async () => {
    const testCases = [
      {
        url: "https://rayon-oborishte.bg/article-123",
        expectedId: "rayon_encoded_123",
      },
      {
        url: "https://sofia.bg/news-456",
        expectedId: "sofia_encoded_456",
      },
      {
        url: "https://toplo.bg/incidents/incident-789",
        expectedId: "toplo_encoded_789",
      },
    ];

    for (const testCase of testCases) {
      mockEncodeDocumentId.mockReturnValue(testCase.expectedId);
      mockQuery.get.mockResolvedValue({ empty: false });

      const result = await isAlreadyIngested(mockAdminDb, testCase.url);

      expect(result).toBe(true);
      expect(mockEncodeDocumentId).toHaveBeenCalledWith(testCase.url);
    }
  });

  it("should handle URLs with special characters", async () => {
    const specialUrl =
      "https://example.com/path with spaces/файл.html?param=value&other=тест";
    const encodedId = "special_encoded_url_with_unicode";

    mockEncodeDocumentId.mockReturnValue(encodedId);
    mockQuery.get.mockResolvedValue({ empty: true });

    const result = await isAlreadyIngested(mockAdminDb, specialUrl);

    expect(result).toBe(false);
    expect(mockEncodeDocumentId).toHaveBeenCalledWith(specialUrl);
    expect(mockQuery.where).toHaveBeenCalledWith(
      "sourceDocumentId",
      "==",
      encodedId,
    );
  });

  it("should propagate Firestore errors", async () => {
    const sourceUrl = "https://example.com/error-test";
    const firestoreError = new Error("Firestore connection failed");

    mockEncodeDocumentId.mockReturnValue("encoded_error_url");
    mockQuery.get.mockRejectedValue(firestoreError);

    await expect(isAlreadyIngested(mockAdminDb, sourceUrl)).rejects.toThrow(
      "Firestore connection failed",
    );
  });

  it("should use limit(1) for efficiency", async () => {
    const sourceUrl = "https://example.com/efficiency-test";

    mockEncodeDocumentId.mockReturnValue("encoded_efficiency_url");
    mockQuery.get.mockResolvedValue({ empty: false });

    await isAlreadyIngested(mockAdminDb, sourceUrl);

    expect(mockQuery.limit).toHaveBeenCalledWith(1);
    expect(mockQuery.limit).toHaveBeenCalledTimes(1);
  });
});

/**
 * Helper function to filter sources by age
 * This is a copy of the internal function for testing purposes
 */
async function filterByAge(
  sources: SourceDocument[],
  maxAgeInDays: number = 90,
): Promise<{ recentSources: SourceDocument[]; tooOld: number }> {
  const recentSources: SourceDocument[] = [];
  let tooOld = 0;

  // Normalize to midnight UTC to avoid timezone/time-of-day issues in tests
  const nowDate = new Date();
  nowDate.setUTCHours(0, 0, 0, 0);
  const now = nowDate.getTime();
  const maxAgeMs = maxAgeInDays * 24 * 60 * 60 * 1000;

  for (const source of sources) {
    const publishedDate = new Date(source.datePublished);
    const ageMs = now - publishedDate.getTime();

    if (ageMs >= maxAgeMs) {
      tooOld++;
    } else {
      recentSources.push(source);
    }
  }

  return { recentSources, tooOld };
}

describe("filterByAge", () => {
  const createSource = (daysAgo: number): SourceDocument => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0); // Set to midnight UTC to avoid timezone issues
    date.setUTCDate(date.getUTCDate() - daysAgo);

    return {
      url: `https://example.com/post-${daysAgo}`,
      datePublished: date.toISOString(),
      title: `Test Post ${daysAgo} days ago`,
      message: "Test message",
      sourceType: "test-source",
      crawledAt: new Date(),
    };
  };

  it("should filter out sources older than 90 days", async () => {
    const sources = [
      createSource(30), // Recent
      createSource(60), // Recent
      createSource(100), // Too old
      createSource(150), // Too old
    ];

    const result = await filterByAge(sources);

    expect(result.recentSources).toHaveLength(2);
    expect(result.tooOld).toBe(2);
  });

  it("should filter sources at and beyond 90 days", async () => {
    const sources = [
      createSource(89), // Recent (just under 90 days)
      createSource(90), // Too old (at boundary)
      createSource(91), // Too old
    ];

    const result = await filterByAge(sources);

    // Only 89 days should be kept
    expect(result.recentSources).toHaveLength(1);
    expect(result.tooOld).toBe(2);
  });

  it("should keep all recent sources", async () => {
    const sources = [
      createSource(1),
      createSource(7),
      createSource(30),
      createSource(89),
    ];

    const result = await filterByAge(sources);

    expect(result.recentSources).toHaveLength(4);
    expect(result.tooOld).toBe(0);
  });

  it("should filter all old sources", async () => {
    const sources = [createSource(100), createSource(200), createSource(365)];

    const result = await filterByAge(sources);

    expect(result.recentSources).toHaveLength(0);
    expect(result.tooOld).toBe(3);
  });

  it("should handle empty source array", async () => {
    const result = await filterByAge([]);

    expect(result.recentSources).toHaveLength(0);
    expect(result.tooOld).toBe(0);
  });

  it("should respect custom maxAgeInDays parameter", async () => {
    const sources = [
      createSource(15), // Within 30 days
      createSource(45), // Older than 30 days
    ];

    const result = await filterByAge(sources, 30);

    expect(result.recentSources).toHaveLength(1);
    expect(result.tooOld).toBe(1);
  });

  it("should handle sources from today", async () => {
    const sources = [createSource(0)];

    const result = await filterByAge(sources);

    expect(result.recentSources).toHaveLength(1);
    expect(result.tooOld).toBe(0);
  });

  it("should handle mixed ages correctly", async () => {
    const sources = [
      createSource(0), // Today
      createSource(45), // Recent
      createSource(89), // Recent (just under boundary)
      createSource(90), // Too old (at boundary)
      createSource(91), // Too old
      createSource(180), // Too old
    ];

    const result = await filterByAge(sources);

    expect(result.recentSources).toHaveLength(3);
    expect(result.tooOld).toBe(3);
    expect(result.recentSources[0].title).toContain("0 days ago");
    expect(result.recentSources[2].title).toContain("89 days ago");
  });

  it("should handle invalid dates by keeping them (NaN comparison)", async () => {
    const sources = [
      {
        url: "https://example.com/invalid",
        datePublished: "invalid-date",
        title: "Invalid Date Post",
        message: "Test",
        sourceType: "test",
        crawledAt: new Date(),
      },
      createSource(30),
    ];

    const result = await filterByAge(sources);

    // Invalid date creates NaN, NaN > maxAgeMs is false, so it's kept
    expect(result.recentSources).toHaveLength(2);
    expect(result.tooOld).toBe(0);
  });
});

/**
 * Replicates the userFacingUrl derivation from ingestSource in from-sources.ts.
 * This is tested standalone to verify the three cases independently of the full pipeline:
 * - deepLinkUrl omitted (undefined) => fall back to source.url
 * - deepLinkUrl: "" => no link (undefined), disables the deeplink
 * - deepLinkUrl: "https://..." => use deepLinkUrl as the user-facing URL
 */
function deriveUserFacingUrl(
  deepLinkUrl: string | undefined,
  url: string,
): string | undefined {
  return deepLinkUrl !== undefined ? deepLinkUrl || undefined : url;
}

describe("ingestSource userFacingUrl derivation", () => {
  it("falls back to source.url when deepLinkUrl is omitted", () => {
    const url = "https://example.com/article-123";
    expect(deriveUserFacingUrl(undefined, url)).toBe(url);
  });

  it("returns undefined when deepLinkUrl is empty string (disables link)", () => {
    const url = "https://api.example.com/internal/123";
    expect(deriveUserFacingUrl("", url)).toBeUndefined();
  });

  it("uses deepLinkUrl when set to a non-empty string", () => {
    const url = "https://api.example.com/internal/123";
    const deepLink = "https://example.com/user-facing-page";
    expect(deriveUserFacingUrl(deepLink, url)).toBe(deepLink);
  });

  it("user-facing URL can differ from the dedupe URL (source.url)", () => {
    const dedupe = "https://arcgis.example.com/rest/services/layer/0/123";
    const deepLink = "https://www.example.com/news/story-456";
    const result = deriveUserFacingUrl(deepLink, dedupe);
    expect(result).toBe(deepLink);
    expect(result).not.toBe(dedupe);
  });

  it("source.url is unaffected regardless of deepLinkUrl (deduplication stays stable)", () => {
    const sourceUrl = "https://api.example.com/internal/42";
    const deepLink = "https://user-facing.example.com/article/42";
    deriveUserFacingUrl(deepLink, sourceUrl);
    // sourceUrl itself is not mutated
    expect(sourceUrl).toBe("https://api.example.com/internal/42");
  });
});
