import { describe, it, expect } from "vitest";
import {
  parseFilterSplitResponse,
  parseCategorizeResponse,
  parseExtractLocationsResponse,
  parseSummarizeResponse,
} from "./ai-response-parser";
import type { IngestErrorRecorder } from "./ingest-errors";

function createMockRecorder(): IngestErrorRecorder & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    warn: () => {},
    error: (msg: string) => errors.push(msg),
    exception: () => {},
  };
}

describe("ai-response-parser", () => {
  describe("parseFilterSplitResponse", () => {
    it("should parse a valid filter & split response", () => {
      const response = JSON.stringify([
        {
          plainText: "Water outage tomorrow",
          isOneOfMany: false,
          isInformative: true,
          isRelevant: true,
          responsibleEntity: "Sofiyska Voda",
          markdownText: "**Water outage** tomorrow",
        },
        {
          plainText: "Irrelevant post",
          isOneOfMany: false,
          isInformative: false,
          isRelevant: false,
        },
      ]);
      const result = parseFilterSplitResponse(response);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0].plainText).toBe("Water outage tomorrow");
      expect(result![0].isOneOfMany).toBe(false);
      expect(result![0].isInformative).toBe(true);
      expect(result![0].isRelevant).toBe(true);
      expect(result![0].responsibleEntity).toBe("Sofiyska Voda");
      expect(result![0].markdownText).toBe("**Water outage** tomorrow");
      expect(result![1].isRelevant).toBe(false);
      expect(result![1].isInformative).toBe(false);
      // Defaults applied for omitted optional fields
      expect(result![1].responsibleEntity).toBe("");
      expect(result![1].markdownText).toBe("");
    });

    it("should return null for invalid JSON", () => {
      const recorder = createMockRecorder();
      const result = parseFilterSplitResponse("{ broken json }", recorder);
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });

    it("should return null when schema validation fails", () => {
      const recorder = createMockRecorder();
      // Missing required fields
      const response = JSON.stringify([{ isRelevant: true }]);
      const result = parseFilterSplitResponse(response, recorder);
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });
  });

  describe("parseCategorizeResponse", () => {
    it("should parse a valid categorization response", () => {
      const response = JSON.stringify({
        categories: ["water", "construction-and-repairs"],
      });
      const result = parseCategorizeResponse(response);
      expect(result).not.toBeNull();
      expect(result!.categories).toEqual(["water", "construction-and-repairs"]);
    });

    it("should handle categories as a comma-separated string", () => {
      const response = JSON.stringify({
        categories: "water, electricity",
      });
      const result = parseCategorizeResponse(response);
      expect(result).not.toBeNull();
      expect(result!.categories).toEqual(["water", "electricity"]);
    });

    it("should handle a single category string", () => {
      const response = JSON.stringify({
        categories: "water",
      });
      const result = parseCategorizeResponse(response);
      expect(result).not.toBeNull();
      expect(result!.categories).toEqual(["water"]);
    });

    it("should return null for invalid JSON", () => {
      const recorder = createMockRecorder();
      const result = parseCategorizeResponse("not valid json", recorder);
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });

    it("should return null for invalid categories", () => {
      const recorder = createMockRecorder();
      const response = JSON.stringify({
        categories: ["not-a-real-category"],
      });
      const result = parseCategorizeResponse(response, recorder);
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });
  });

  describe("parseExtractLocationsResponse", () => {
    it("should parse a valid extract locations response", () => {
      const response = JSON.stringify({
        withSpecificAddress: true,
        busStops: ["Bus stop A"],
        cityWide: false,
        pins: [
          {
            address: "бул. Витоша 1",
            timespans: [
              { start: "2024-01-01T10:00:00Z", end: "2024-01-01T12:00:00Z" },
            ],
          },
        ],
        streets: [
          {
            street: "бул. Витоша",
            from: "ул. Алабин",
            to: "пл. България",
            timespans: [
              { start: "2024-01-01T10:00:00Z", end: "2024-01-01T12:00:00Z" },
            ],
          },
        ],
        cadastralProperties: [
          {
            identifier: "68134.501.123",
            timespans: [
              { start: "2024-01-01T10:00:00Z", end: "2024-01-01T12:00:00Z" },
            ],
          },
        ],
      });
      const result = parseExtractLocationsResponse(response);
      expect(result).not.toBeNull();
      expect(result!.withSpecificAddress).toBe(true);
      expect(result!.cityWide).toBe(false);
      expect(result!.busStops).toEqual(["Bus stop A"]);
      expect(result!.pins).toHaveLength(1);
      expect(result!.pins[0].address).toBe("бул. Витоша 1");
      expect(result!.streets).toHaveLength(1);
      expect(result!.streets[0].street).toBe("бул. Витоша");
      expect(result!.cadastralProperties).toHaveLength(1);
      expect(result!.cadastralProperties[0].identifier).toBe("68134.501.123");
    });

    it("should apply defaults for omitted array fields", () => {
      const response = JSON.stringify({
        withSpecificAddress: false,
        cityWide: true,
      });
      const result = parseExtractLocationsResponse(response);
      expect(result).not.toBeNull();
      expect(result!.pins).toEqual([]);
      expect(result!.streets).toEqual([]);
      expect(result!.cadastralProperties).toEqual([]);
      expect(result!.busStops).toEqual([]);
    });

    it("should return null when no JSON is found", () => {
      const recorder = createMockRecorder();
      const result = parseExtractLocationsResponse("no json here", recorder);
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });

    it("should return null for invalid JSON", () => {
      const recorder = createMockRecorder();
      const result = parseExtractLocationsResponse(
        '{ "invalid": json }',
        recorder,
      );
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });

    it("should return null when required fields are missing", () => {
      const recorder = createMockRecorder();
      // Missing withSpecificAddress and cityWide, should apply defaults
      const response = JSON.stringify({ pins: [] });
      const result = parseExtractLocationsResponse(response, recorder);
      expect(result).not.toBeNull();
      expect(result!.withSpecificAddress).toBe(false);
      expect(result!.cityWide).toBe(false);
      expect(result!.pins).toEqual([]);
      expect(result!.streets).toEqual([]);
      expect(result!.cadastralProperties).toEqual([]);
      expect(result!.busStops).toEqual([]);
    });

    it("should keep street item and drop invalid toCoordinates/fromCoordinates", () => {
      // Reproduces: AI returns toCoordinates with lat/lng undefined (empty object)
      const recorder = createMockRecorder();
      const response = JSON.stringify({
        streets: [
          {
            street: "бул. Витоша",
            from: "ул. Алабин",
            to: "пл. България",
            toCoordinates: {}, // invalid: lat and lng are missing
            fromCoordinates: { lat: null, lng: null }, // invalid: nulls instead of numbers
            timespans: [
              { start: "2024-01-01T10:00:00Z", end: "2024-01-01T12:00:00Z" },
            ],
          },
        ],
      });
      const result = parseExtractLocationsResponse(response, recorder);
      expect(result).not.toBeNull();
      // Street item is preserved (not dropped)
      expect(result!.streets).toHaveLength(1);
      expect(result!.streets[0].street).toBe("бул. Витоша");
      // Invalid coordinates are stripped rather than causing item rejection
      expect(result!.streets[0].toCoordinates).toBeUndefined();
      expect(result!.streets[0].fromCoordinates).toBeUndefined();
    });
  });

  describe("parseSummarizeResponse", () => {
    it("should parse a valid summarize response", () => {
      const response = JSON.stringify({ summary: "Водна авария на бул. Витоша" });
      const result = parseSummarizeResponse(response);
      expect(result).not.toBeNull();
      expect(result!.summary).toBe("Водна авария на бул. Витоша");
    });

    it("should parse a markdown summary", () => {
      const response = JSON.stringify({
        summary: "**Водна авария** на бул. Витоша от **10:00** до **18:00**",
      });
      const result = parseSummarizeResponse(response);
      expect(result).not.toBeNull();
      expect(result!.summary).toBe(
        "**Водна авария** на бул. Витоша от **10:00** до **18:00**",
      );
    });

    it("should return null for invalid JSON", () => {
      const recorder = createMockRecorder();
      const result = parseSummarizeResponse("{ broken json }", recorder);
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });

    it("should return null when summary field is missing", () => {
      const recorder = createMockRecorder();
      const result = parseSummarizeResponse(
        JSON.stringify({ other: "field" }),
        recorder,
      );
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });

    it("should return null when summary is not a string", () => {
      const recorder = createMockRecorder();
      const result = parseSummarizeResponse(
        JSON.stringify({ summary: 42 }),
        recorder,
      );
      expect(result).toBeNull();
      expect(recorder.errors.length).toBeGreaterThan(0);
    });
  });
});
