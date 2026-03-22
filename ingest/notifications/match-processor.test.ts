import { describe, it, expect, vi } from "vitest";
import { deduplicateMatches, shouldNotifyUser } from "./match-processor";
import type { MatchResult, UserNotificationFilters } from "./match-processor";

// Mock the isExperimentalSource function from @oboapp/shared
const { mockIsExperimentalSource } = vi.hoisted(() => ({
  mockIsExperimentalSource: vi.fn((_id: string) => false),
}));

vi.mock("@oboapp/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oboapp/shared")>();
  return {
    ...actual,
    isExperimentalSource: (id: string) => mockIsExperimentalSource(id),
  };
});

describe("match-processor", () => {
  describe("deduplicateMatches", () => {
    it("should keep match with smallest distance for same user-message pair", () => {
      const matches: MatchResult[] = [
        {
          messageId: "msg1",
          userId: "user1",
          interestId: "int1",
          distance: 500,
        },
        {
          messageId: "msg1",
          userId: "user1",
          interestId: "int2",
          distance: 300,
        },
        {
          messageId: "msg1",
          userId: "user1",
          interestId: "int3",
          distance: 700,
        },
      ];

      const result = deduplicateMatches(matches);

      expect(result).toHaveLength(1);
      expect(result[0].distance).toBe(300);
      expect(result[0].interestId).toBe("int2");
    });

    it("should keep separate matches for different users", () => {
      const matches: MatchResult[] = [
        {
          messageId: "msg1",
          userId: "user1",
          interestId: "int1",
          distance: 500,
        },
        {
          messageId: "msg1",
          userId: "user2",
          interestId: "int2",
          distance: 300,
        },
      ];

      const result = deduplicateMatches(matches);

      expect(result).toHaveLength(2);
    });

    it("should keep separate matches for different messages", () => {
      const matches: MatchResult[] = [
        {
          messageId: "msg1",
          userId: "user1",
          interestId: "int1",
          distance: 500,
        },
        {
          messageId: "msg2",
          userId: "user1",
          interestId: "int1",
          distance: 300,
        },
      ];

      const result = deduplicateMatches(matches);

      expect(result).toHaveLength(2);
    });

    it("should handle empty array", () => {
      const result = deduplicateMatches([]);

      expect(result).toHaveLength(0);
    });

    it("should handle single match", () => {
      const matches: MatchResult[] = [
        {
          messageId: "msg1",
          userId: "user1",
          interestId: "int1",
          distance: 500,
        },
      ];

      const result = deduplicateMatches(matches);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(matches[0]);
    });
  });

  describe("shouldNotifyUser", () => {
    it("should allow all when filters are undefined", () => {
      expect(
        shouldNotifyUser(undefined, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
      ).toBe(true);
    });

    it("should allow all when both filter arrays are empty", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(),
        notificationSources: new Set(),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
      ).toBe(true);
    });

    // Category filtering
    it("should allow message when its category matches the filter", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["water"]),
        notificationSources: new Set([]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
      ).toBe(true);
    });

    it("should reject message when its category does not match", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["water"]),
        notificationSources: new Set([]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["electricity"],
          source: "erm-zapad",
        }),
      ).toBe(false);
    });

    it("should allow message when any of its categories match", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["water"]),
        notificationSources: new Set([]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["construction-and-repairs", "water"],
          source: "sofiyska-voda",
        }),
      ).toBe(true);
    });

    it("should allow uncategorized messages when 'uncategorized' is selected", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["uncategorized"]),
        notificationSources: new Set([]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, { categories: [], source: "sofia-bg" }),
      ).toBe(true);
    });

    it("should allow uncategorized messages when categories is undefined", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["uncategorized"]),
        notificationSources: new Set([]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: undefined,
          source: "sofia-bg",
        }),
      ).toBe(true);
    });

    it("should reject uncategorized messages when 'uncategorized' is not selected", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["water"]),
        notificationSources: new Set([]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, { categories: [], source: "sofia-bg" }),
      ).toBe(false);
    });

    // Source filtering
    it("should allow message when its source matches the filter", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set([]),
        notificationSources: new Set(["sofiyska-voda"]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
      ).toBe(true);
    });

    it("should reject message when its source does not match", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set([]),
        notificationSources: new Set(["sofiyska-voda"]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["heating"],
          source: "toplo-bg",
        }),
      ).toBe(false);
    });

    it("should reject message when source is undefined and source filter is active", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set([]),
        notificationSources: new Set(["sofiyska-voda"]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, { categories: ["water"], source: undefined }),
      ).toBe(false);
    });

    // Combined filtering
    it("should allow when both category and source match", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["water"]),
        notificationSources: new Set(["sofiyska-voda"]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
      ).toBe(true);
    });

    it("should reject when category matches but source does not", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["water"]),
        notificationSources: new Set(["sofiyska-voda"]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "toplo-bg",
        }),
      ).toBe(false);
    });

    it("should reject when source matches but category does not", () => {
      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["water"]),
        notificationSources: new Set(["sofiyska-voda"]),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["electricity"],
          source: "sofiyska-voda",
        }),
      ).toBe(false);
    });
  });

  describe("shouldNotifyUser - experimental sources", () => {
    // Experimental sources are opt-in: even users with no preferences doc
    // (undefined filters) are blocked. This differs from the "allow all"
    // default for category/source filters because experimental requires
    // an explicit opt-in.
    it("should reject experimental source when user has no preferences", () => {
      mockIsExperimentalSource.mockImplementation(
        (id: string) => id === "experimental-source",
      );

      expect(
        shouldNotifyUser(undefined, {
          categories: ["water"],
          source: "experimental-source",
        }),
      ).toBe(false);

      mockIsExperimentalSource.mockReset();
    });

    it("should reject experimental source when experimentalFeatures is false", () => {
      mockIsExperimentalSource.mockImplementation(
        (id: string) => id === "experimental-source",
      );

      const filters: UserNotificationFilters = {
        notificationCategories: new Set(),
        notificationSources: new Set(),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "experimental-source",
        }),
      ).toBe(false);

      mockIsExperimentalSource.mockReset();
    });

    it("should allow experimental source when experimentalFeatures is true", () => {
      mockIsExperimentalSource.mockImplementation(
        (id: string) => id === "experimental-source",
      );

      const filters: UserNotificationFilters = {
        notificationCategories: new Set(),
        notificationSources: new Set(),
        experimentalFeatures: true,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "experimental-source",
        }),
      ).toBe(true);

      mockIsExperimentalSource.mockReset();
    });

    it("should still apply category/source filters for experimental sources", () => {
      mockIsExperimentalSource.mockImplementation(
        (id: string) => id === "experimental-source",
      );

      const filters: UserNotificationFilters = {
        notificationCategories: new Set(["electricity"]),
        notificationSources: new Set(),
        experimentalFeatures: true,
      };
      // Category doesn't match
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "experimental-source",
        }),
      ).toBe(false);

      mockIsExperimentalSource.mockReset();
    });

    it("should allow non-experimental source regardless of experimentalFeatures flag", () => {
      mockIsExperimentalSource.mockReturnValue(false);

      const filters: UserNotificationFilters = {
        notificationCategories: new Set(),
        notificationSources: new Set(),
        experimentalFeatures: false,
      };
      expect(
        shouldNotifyUser(filters, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
      ).toBe(true);

      mockIsExperimentalSource.mockReset();
    });
  });
});
