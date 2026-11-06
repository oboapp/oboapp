import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSourceContent } from "./source-content";

const content = {
  title: "Notice",
  message: "Work",
  datePublished: "2026-10-19",
};

beforeEach(() => {
  vi.stubEnv("LOCALITY", "bg.sofia");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("preserves optional content, converts dates, and removes undefined values", () => {
  expect(parseSourceContent({
    ...content,
    markdownText: "**Work**",
    deepLinkUrl: "",
    categories: [" heating "],
    timespanStart: "2026-10-19T00:00:00Z",
    timespanEnd: undefined,
    isRelevant: true,
  })).toEqual({
    ...content,
    markdownText: "**Work**",
    deepLinkUrl: "",
    categories: ["heating"],
    timespanStart: new Date("2026-10-19T00:00:00Z"),
    isRelevant: true,
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

it.each(["strict", "legacy-toplo"] as const)("does not silently drop invalid features in %s mode", (validation) => {
  expect(() => parseSourceContent({
    ...content,
    geoJson: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [23.32, 42.69] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [999, 999] } },
      ],
    },
  }, validation)).toThrow("Invalid source GeoJSON");
});

it.each([
  { field: "title", value: "" },
  { field: "datePublished", value: "invalid" },
  { field: "datePublished", value: "" },
])("keeps strict validation as the default for $field=$value", ({ field, value }) => {
  const invalidContent = { ...content, [field]: value };
  expect(() => parseSourceContent(invalidContent)).toThrow();
  expect(() => parseSourceContent(invalidContent, "strict")).toThrow();
});

it.each(["invalid", "", "2024-01-01T00:00:00Z"])("preserves Toplo's literal title and publication date %j", (datePublished) => {
  expect(parseSourceContent({
    ...content,
    title: "",
    datePublished,
    timespanStart: "2026-10-19T00:00:00Z",
    timespanEnd: "2026-10-19T01:00:00Z",
  }, "legacy-toplo")).toEqual({
    ...content,
    title: "",
    datePublished,
    timespanStart: new Date("2026-10-19T00:00:00Z"),
    timespanEnd: new Date("2026-10-19T01:00:00Z"),
  });
});

it.each([
  { field: "title", value: null },
  { field: "datePublished", value: null },
  { field: "message", value: "" },
  { field: "timespanStart", value: "invalid" },
  { field: "timespanEnd", value: "invalid" },
  { field: "geoJson", value: { type: "Point", coordinates: [23, 42] } },
])("retains Toplo validation of $field", ({ field, value }) => {
  expect(() => parseSourceContent({
    ...content,
    [field]: value,
  }, "legacy-toplo")).toThrow();
});

it.each(["strict", "legacy-toplo"] as const)("strips platform-owned fields in %s mode", (validation) => {
  expect(parseSourceContent({
    ...content,
    url: "https://wrong.example/identity",
    sourceType: "wrong-source",
    locality: "wrong-locality",
    crawledAt: "2020-01-01T00:00:00Z",
    processed: true,
  }, validation)).toEqual(content);
});
