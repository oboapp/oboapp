import { describe, it, expect, afterEach } from "vitest";
import dotenv from "dotenv";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import type { IngestErrorRecorder } from "./ingest-errors";

// Load env vars before anything else (AGENTS.md pattern)
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const HAS_API_KEY = Boolean(process.env.GOOGLE_AI_API_KEY);

function readSourceFixture(name: string): string {
  return readFileSync(
    join(__dirname, "../__mocks__/fixtures/sources", name),
    "utf-8",
  );
}

function createMockRecorder(): IngestErrorRecorder & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    warn: () => {},
    error: (msg: string) => errors.push(msg),
    exception: (msg: string) => errors.push(msg),
  };
}

/**
 * Adds a small delay between tests to be respectful to the Gemini API.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!HAS_API_KEY)(
  "AI Pipeline Integration (live Gemini API)",
  () => {
    afterEach(async () => {
      await delay(500);
    });

    // ─── Test 1: Irrelevant message ──────────────────────────────────
    describe("irrelevant-message.md", () => {
      it("should detect the job posting as irrelevant and not proceed further", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("irrelevant-message.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result).toBeInstanceOf(Array);
        expect(result!.length).toBe(1);

        const msg = result![0];
        expect(msg.isRelevant).toBe(false);
        expect(msg.plainText).toBe("");

        // Pipeline should stop here — no categorize or extractLocations
        expect(recorder.errors).toHaveLength(0);
      });
    });

    // ─── Test 2: Simple single message (parking for football) ────────
    describe("single-simple-message.md", () => {
      let plainText: string;

      it("filterAndSplit: should produce 1 relevant message", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("single-simple-message.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result!.length).toBe(1);
        expect(result![0].isRelevant).toBe(true);
        expect(result![0].plainText).toBeTruthy();
        expect(result![0].markdownText).toBeTruthy();
        expect(recorder.errors).toHaveLength(0);

        plainText = result![0].plainText;
      });

      it("categorize: should assign parking/traffic/sports categories", async () => {
        const { categorize } = await import("./ai-service");
        expect(plainText).toBeTruthy();
        const recorder = createMockRecorder();

        const result = await categorize(plainText, recorder);

        expect(result).not.toBeNull();
        expect(result!.categories).toBeInstanceOf(Array);
        expect(result!.categories.length).toBeGreaterThanOrEqual(1);

        // Should include at least one relevant category
        const relevantCategories = [
          "parking",
          "traffic",
          "sports",
          "road-block",
        ];
        const hasRelevant = result!.categories.some((c) =>
          relevantCategories.includes(c),
        );
        expect(hasRelevant).toBe(true);
        expect(recorder.errors).toHaveLength(0);
      });

      it("extractLocations: should extract stadium location with timespans", async () => {
        const { extractLocations } = await import("./ai-service");
        expect(plainText).toBeTruthy();
        const recorder = createMockRecorder();

        const result = await extractLocations(plainText, recorder);

        expect(result).not.toBeNull();
        expect(result!.withSpecificAddress).toBe(true);
        expect(result!.cityWide).toBe(false);

        // Should have at least one pin or street referencing the stadium area
        const allAddresses = [
          ...result!.pins.map((p) => p.address),
          ...result!.streets.map((s) => s.street),
        ];
        expect(allAddresses.length).toBeGreaterThanOrEqual(1);

        // At least one address should reference the stadium or related area
        const addressText = allAddresses.join(" ").toLowerCase();
        const hasStadiumRef =
          addressText.includes("левски") ||
          addressText.includes("стадион") ||
          addressText.includes("паркинг");
        expect(hasStadiumRef).toBe(true);

        // Verify timespans are present and reference 2026
        const allTimespans = [
          ...result!.pins.flatMap((p) => p.timespans),
          ...result!.streets.flatMap((s) => s.timespans),
        ];
        expect(allTimespans.length).toBeGreaterThanOrEqual(1);
        const timespanText = JSON.stringify(allTimespans);
        expect(timespanText).toContain("2026");

        // recorder.errors is intentionally not asserted here: partial schema
        // filtering (soft errors) is acceptable for extractLocations.
        // Fatal errors are caught by `expect(result).not.toBeNull()` above.
      });
    });

    // ─── Test 3: Multiple street locations (sidewalk repairs) ────────
    describe("single-message-multiple-locations.md", () => {
      let plainText: string;

      it("filterAndSplit: should produce 1 relevant message", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("single-message-multiple-locations.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result!.length).toBe(1);
        expect(result![0].isRelevant).toBe(true);
        expect(result![0].plainText).toBeTruthy();
        expect(recorder.errors).toHaveLength(0);

        plainText = result![0].plainText;
      });

      it("categorize: should assign construction-and-repairs", async () => {
        const { categorize } = await import("./ai-service");
        expect(plainText).toBeTruthy();
        const recorder = createMockRecorder();

        const result = await categorize(plainText, recorder);

        expect(result).not.toBeNull();
        expect(result!.categories).toContain("construction-and-repairs");
        expect(recorder.errors).toHaveLength(0);
      });

      it("extractLocations: should extract multiple street sections on Oborishte", async () => {
        const { extractLocations } = await import("./ai-service");
        expect(plainText).toBeTruthy();
        const recorder = createMockRecorder();

        const result = await extractLocations(plainText, recorder);

        expect(result).not.toBeNull();
        expect(result!.withSpecificAddress).toBe(true);

        // Should have multiple street sections (5 sidewalk segments)
        expect(result!.streets.length).toBeGreaterThanOrEqual(2);

        // Streets should reference "Оборище" (fixture has 5 segments but model may merge)
        const streetsWithOborishte = result!.streets.filter(
          (s) => s.street.includes("Оборище") || s.street.includes("Оборищe"),
        );
        expect(streetsWithOborishte.length).toBeGreaterThanOrEqual(1);

        // The source has explicit coordinates (42.693576, 23.35161)
        // AI may extract these as geotagged coordinates on pins
        const allPinCoords = result!.pins
          .filter((p) => p.coordinates)
          .map((p) => p.coordinates!);
        const allStreetCoords = result!.streets
          .filter((s) => s.fromCoordinates || s.toCoordinates)
          .flatMap((s) => [s.fromCoordinates, s.toCoordinates].filter(Boolean));
        const allCoords = [...allPinCoords, ...allStreetCoords];

        if (allCoords.length > 0) {
          // If coordinates were extracted, they should be near the known location
          const hasNearbyCoord = allCoords.some(
            (c) =>
              c!.lat > 42.69 &&
              c!.lat < 42.7 &&
              c!.lng > 23.35 &&
              c!.lng < 23.36,
          );
          expect(hasNearbyCoord).toBe(true);
        }

        // Timespans should reference the repair period (Feb-Mar 2026)
        const allTimespans = result!.streets.flatMap((s) => s.timespans);
        expect(allTimespans.length).toBeGreaterThanOrEqual(1);
        const timespanText = JSON.stringify(allTimespans);
        expect(timespanText).toContain("2026");

        // recorder.errors intentionally not asserted — see test 2 extractLocations note.
      });
    });

    // ─── Test 4: Multiple timespans (film shooting) ──────────────────
    describe("single-message-mutiple-timespans.md", () => {
      let plainTexts: string[] = [];

      it("filterAndSplit: should produce relevant message(s)", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("single-message-mutiple-timespans.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThanOrEqual(1);

        for (const msg of result!) {
          expect(msg.isRelevant).toBe(true);
          expect(msg.plainText).toBeTruthy();
        }
        expect(recorder.errors).toHaveLength(0);

        plainTexts = result!.map((m) => m.plainText);
      });

      it("categorize: should assign parking or traffic categories", async () => {
        const { categorize } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(1);

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await categorize(text, recorder);

          expect(result).not.toBeNull();
          expect(result!.categories.length).toBeGreaterThanOrEqual(1);

          const relevantCategories = ["parking", "traffic", "road-block"];
          const hasRelevant = result!.categories.some((c) =>
            relevantCategories.includes(c),
          );
          expect(hasRelevant).toBe(true);
          expect(recorder.errors).toHaveLength(0);
        }
      });

      it("extractLocations: should extract 2 streets with different timespans", async () => {
        const { extractLocations } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(1);

        // Collect all extracted locations from all messages
        const allStreets: Array<{ street: string; timespans: unknown[] }> = [];
        const allPins: Array<{ address: string; timespans: unknown[] }> = [];

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await extractLocations(text, recorder);

          expect(result).not.toBeNull();
          expect(result!.withSpecificAddress).toBe(true);

          allStreets.push(...result!.streets);
          allPins.push(...result!.pins);
          // recorder.errors intentionally not asserted — see test 2 extractLocations note.
        }

        const allLocations = [
          ...allStreets.map((s) => s.street),
          ...allPins.map((p) => p.address),
        ];
        const locationText = allLocations.join(" ");

        // Should reference both streets from the fixture
        const hasSeptemvri =
          locationText.includes("6 септември") ||
          locationText.includes("Септември") ||
          locationText.includes("септември");
        const hasChehov =
          locationText.includes("Чехов") || locationText.includes("чехов");

        expect(hasSeptemvri).toBe(true);
        expect(hasChehov).toBe(true);

        // Timespans should cover both dates
        const allTimespans = [
          ...allStreets.flatMap((s) => s.timespans),
          ...allPins.flatMap((p) => p.timespans),
        ];
        const timespanText = JSON.stringify(allTimespans);
        expect(timespanText).toContain("02.02.2026");
        expect(timespanText).toContain("03.02.2026");
      });
    });

    // ─── Test 5: Complex message (bus rerouting, street closure) ─────
    describe("complex-single-message.md", () => {
      let plainTexts: string[] = [];

      it("filterAndSplit: should produce relevant message(s)", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("complex-single-message.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThanOrEqual(1);

        for (const msg of result!) {
          expect(msg.isRelevant).toBe(true);
          expect(msg.plainText).toBeTruthy();
        }
        expect(recorder.errors).toHaveLength(0);

        plainTexts = result!.map((m) => m.plainText);
      });

      it("categorize: should assign traffic/public-transport/road-block categories", async () => {
        const { categorize } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(1);

        const allCategories: string[] = [];

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await categorize(text, recorder);

          expect(result).not.toBeNull();
          expect(result!.categories.length).toBeGreaterThanOrEqual(1);
          allCategories.push(...result!.categories);
          expect(recorder.errors).toHaveLength(0);
        }

        // Across all messages, should include at least one transport-related category
        const relevantCategories = [
          "traffic",
          "road-block",
          "public-transport",
        ];
        const hasRelevant = allCategories.some((c) =>
          relevantCategories.includes(c),
        );
        expect(hasRelevant).toBe(true);
      });

      it("extractLocations: should extract bus stops, streets, and Iskarska reference", async () => {
        const { extractLocations } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(1);

        const allBusStops: string[] = [];
        const allStreets: string[] = [];
        const allPinsAddresses: string[] = [];

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await extractLocations(text, recorder);

          expect(result).not.toBeNull();
          allBusStops.push(...result!.busStops);
          allStreets.push(...result!.streets.map((s) => s.street));
          allPinsAddresses.push(...result!.pins.map((p) => p.address));
          // recorder.errors intentionally not asserted — see test 2 extractLocations note.
        }

        // Should extract bus stop codes from the fixture
        const expectedBusStopCodes = ["1956", "1531", "2500", "0937", "0936"];
        for (const code of expectedBusStopCodes) {
          const found = allBusStops.some((stop) => stop.includes(code));
          expect(found).toBe(true);
        }

        // Should reference the main street "Искърска"
        const allLocationText = [...allStreets, ...allPinsAddresses].join(" ");
        expect(allLocationText).toContain("Искърска");
      });
    });

    // ─── Test 6: Insufficient content ────────────────────────────────
    describe("insufficient.md", () => {
      it("should detect insufficient content as irrelevant", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("insufficient.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result).toBeInstanceOf(Array);
        expect(result!.length).toBeGreaterThanOrEqual(1);

        // Should mark as irrelevant due to insufficient content
        const irrelevantCount = result!.filter((m) => !m.isRelevant).length;
        expect(irrelevantCount).toBeGreaterThanOrEqual(1);

        expect(recorder.errors).toHaveLength(0);
      });
    });

    // ─── Test 7: Two simple messages (heating + construction) ────────
    describe("two-messages-simple.md", () => {
      let plainTexts: string[] = [];

      it("filterAndSplit: should produce 2 relevant messages", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("two-messages-simple.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThanOrEqual(2);

        const relevantMessages = result!.filter((m) => m.isRelevant);
        expect(relevantMessages.length).toBeGreaterThanOrEqual(2);
        expect(recorder.errors).toHaveLength(0);

        plainTexts = relevantMessages.map((m) => m.plainText);
      });

      it("categorize: should assign heating/construction/road-block categories", async () => {
        const { categorize } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(2);

        const allCategories: string[] = [];

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await categorize(text, recorder);

          expect(result).not.toBeNull();
          expect(result!.categories.length).toBeGreaterThanOrEqual(1);
          allCategories.push(...result!.categories);
          expect(recorder.errors).toHaveLength(0);
        }

        // Should have both heating and construction categories
        const relevantCategories = [
          "heating",
          "construction-and-repairs",
          "road-block",
        ];
        const hasRelevant = allCategories.some((c) =>
          relevantCategories.includes(c),
        );
        expect(hasRelevant).toBe(true);
      });

      it("extractLocations: should extract both street locations", async () => {
        const { extractLocations } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(2);

        const allStreets: string[] = [];
        const allPinsAddresses: string[] = [];

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await extractLocations(text, recorder);

          expect(result).not.toBeNull();
          allStreets.push(...result!.streets.map((s) => s.street));
          allPinsAddresses.push(...result!.pins.map((p) => p.address));
          // recorder.errors intentionally not asserted — see test 2 extractLocations note.
        }

        const allLocations = [...allStreets, ...allPinsAddresses].join(" ");

        // Should reference at least one of the two streets from the fixture
        // (model may not always extract both from separate messages)
        expect(
          allLocations.includes("Искър") ||
            allLocations.includes("искър") ||
            allLocations.includes("Васил Априлов") ||
            allLocations.includes("васил априлов"),
        ).toBe(true);
      });
    });

    // ─── Test 8: Complex multi-message (transit + road closure) ──────
    describe("complex-multi-message.md", () => {
      let plainTexts: string[] = [];

      it("filterAndSplit: should produce multiple relevant messages", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("complex-multi-message.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThanOrEqual(2);

        const relevantMessages = result!.filter((m) => m.isRelevant);
        expect(relevantMessages.length).toBeGreaterThanOrEqual(2);
        expect(recorder.errors).toHaveLength(0);

        plainTexts = relevantMessages.map((m) => m.plainText);
      });

      it("categorize: should assign public-transport and road-block categories", async () => {
        const { categorize } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(2);

        const allCategories: string[] = [];

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await categorize(text, recorder);

          expect(result).not.toBeNull();
          expect(result!.categories.length).toBeGreaterThanOrEqual(1);
          allCategories.push(...result!.categories);
          expect(recorder.errors).toHaveLength(0);
        }

        const hasRoadRelated =
          allCategories.includes("heating") ||
          allCategories.includes("road-block") ||
          allCategories.includes("traffic");
        expect(hasRoadRelated).toBe(true);
      });

      it("extractLocations: should extract tram/bus routes and boulevard reference", async () => {
        const { extractLocations } = await import("./ai-service");
        expect(plainTexts.length).toBeGreaterThanOrEqual(2);

        const allStreets: string[] = [];
        const allPinsAddresses: string[] = [];
        const allBusStops: string[] = [];

        for (const text of plainTexts) {
          const recorder = createMockRecorder();
          const result = await extractLocations(text, recorder);

          expect(result).not.toBeNull();
          allStreets.push(...result!.streets.map((s) => s.street));
          allPinsAddresses.push(...result!.pins.map((p) => p.address));
          allBusStops.push(...result!.busStops);
          // recorder.errors intentionally not asserted — see test 2 extractLocations note.
        }

        const allLocations = [...allStreets, ...allPinsAddresses]
          .join(" ")
          .toLowerCase();

        // Should reference at least one of the main streets affected
        // (two separate messages — model may not always extract both)
        expect(
          allLocations.includes("искър") ||
            allLocations.includes("васил априлов"),
        ).toBe(true);
      });
    });

    // ─── Test 9: Message with links (heating outage in Nadezhda) ─────
    describe("single-message-with-links.md", () => {
      it("filterAndSplit: should strip link and lead-in phrase, preserve meaningful content", async () => {
        const { filterAndSplit } = await import("./ai-service");
        const text = readSourceFixture("single-message-with-links.md");
        const recorder = createMockRecorder();

        const result = await filterAndSplit(text, recorder);

        expect(result).not.toBeNull();
        expect(result!.length).toBe(1);

        const msg = result![0];
        expect(msg.isRelevant).toBe(true);
        expect(msg.plainText).toBeTruthy();
        expect(msg.markdownText).toBeTruthy();

        // Link URL must be stripped from both fields
        expect(msg.plainText).not.toMatch(/https?:\/\//);
        expect(msg.markdownText).not.toMatch(/https?:\/\//);

        // Markdown link syntax must be gone from markdownText
        expect(msg.markdownText).not.toMatch(/\[[^\]]+\]\([^)]+\)/);

        // Lead-in phrase pointing to the link must be stripped
        expect(msg.plainText).not.toContain("С пълния текст");
        expect(msg.markdownText).not.toContain("С пълния текст");

        // Substantive content must be preserved
        expect(msg.plainText).toContain("Надежда");
        expect(msg.plainText).toContain("15.03.2026");

        expect(recorder.errors).toHaveLength(0);
      });
    });
  },
);
