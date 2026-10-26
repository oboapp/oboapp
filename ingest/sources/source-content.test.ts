import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSourceContent } from "./source-content";

const content = { title: "Notice", message: "Work", datePublished: "2026-10-19" };
beforeEach(() => vi.stubEnv("LOCALITY", "bg.sofia"));
afterEach(() => vi.unstubAllEnvs());

it("preserves optional content, converts dates, and removes undefined values", () => {
  expect(parseSourceContent({ ...content, markdownText: "**Work**", deepLinkUrl: "", categories: [" heating "],
    timespanStart: "2026-10-19T00:00:00Z", timespanEnd: undefined, isRelevant: true,
  })).toEqual({ ...content, markdownText: "**Work**", deepLinkUrl: "", categories: ["heating"],
    timespanStart: new Date("2026-10-19T00:00:00Z"), isRelevant: true,
  });
});

it.each([false, true])("stores validated GeoJSON in the existing serialized format (string input: %s)", (serialized) => {
  const geoJson = { type: "FeatureCollection", features: [] };
  expect(parseSourceContent({ ...content, geoJson: serialized ? JSON.stringify(geoJson) : geoJson }).geoJson)
    .toBe(JSON.stringify(geoJson));
});

it.each(["not JSON", null, { type: "Point", coordinates: [23, 42] }])("rejects invalid geometry %j", (geoJson) => {
  expect(() => parseSourceContent({ ...content, geoJson })).toThrow();
});

it("does not silently drop invalid features", () => {
  expect(() => parseSourceContent({ ...content, geoJson: { type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [23.32, 42.69] } },
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [999, 999] } },
  ] } })).toThrow("Invalid source GeoJSON");
});
