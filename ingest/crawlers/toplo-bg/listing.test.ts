import { describe, expect, it } from "vitest";
import { toploHtml } from "@/__mocks__/source-contract-fixtures";
import { countListingIncidents, parseListingIncidents } from "./listing";

describe("countListingIncidents", () => {
  it("captures the complete incident fields without requiring geometry", () => {
    const html = toploHtml(["one"])
      .replace('"Type":1', '"Type":0')
      .replace('"UntilDate":null', '"UntilDate":"2026-11-15T20:00:00Z"');

    expect(parseListingIncidents(html)).toEqual([{
      id: "one",
      accidentId: "one",
      name: "Ремонт",
      addresses: "ул. Тест",
      type: "accident",
      status: 1,
      reportedStart: "2026-10-04T08:00:00.000Z",
      estimatedEnd: "2026-11-15T20:00:00Z",
      createdAt: "2026-10-04T08:00:00.000Z",
    }]);
  });

  it("preserves unknown dates as null rather than inventing restoration times", () => {
    const html = toploHtml(["one"], "invalid")
      .replace('"UntilDate":null', '"UntilDate":"2026-02-30T20:00:00Z"');

    expect(parseListingIncidents(html)[0]).toMatchObject({
      reportedStart: null,
      estimatedEnd: null,
      createdAt: null,
    });
  });

  it("falls back to region and identity when the source name is empty", () => {
    const html = toploHtml(["one"]).replace('"Name":"Ремонт"', '"Name":""');

    expect(parseListingIncidents(html)[0].name).toBe("Sofia");
    expect(parseListingIncidents(html.replace('"Region":"Sofia"', '"Region":""'))[0].name).toBe("one");
  });

  it("rejects conflicting duplicates and unknown incident types", () => {
    const duplicate = toploHtml(["one", "one"])
      .replace('"UntilDate":null', '"UntilDate":"2026-11-15T20:00:00Z"');
    expect(() => parseListingIncidents(duplicate)).toThrow("conflicting");
    expect(() => parseListingIncidents(toploHtml().replace('"Type":1', '"Type":2'))).toThrow("type");
  });
  it("counts distinct listed incidents, including repairs", () => {
    const html = toploHtml(["one", "two", "one"]);

    expect(countListingIncidents(html)).toBe(2);
  });

  it("keeps listed entries whose expected restoration date has passed", () => {
    const html = toploHtml(["one"]).replace(
      '"UntilDate":null',
      '"UntilDate":"2025-01-01T00:00:00Z"',
    );

    expect(countListingIncidents(html)).toBe(1);
  });

  it("counts incidents independently of their map geometry", () => {
    const html = toploHtml(["one", "two"]).replaceAll(
      /var geoJsonString = '[^']*'/g,
      "var geoJsonString = ''",
    );

    expect(countListingIncidents(html)).toBe(2);
  });

  it("accepts a complete empty listing", () => {
    expect(countListingIncidents(toploHtml([]))).toBe(0);
  });

  it.each([
    "<html><body>Service unavailable</body></html>",
    toploHtml([]).replace('id="accidentMap"', 'id="other"'),
    toploHtml([]).replace('id="accidentMap"', 'data-id="accidentMap"'),
    toploHtml([]).replace("function parseAll()", "function other()"),
    toploHtml([]).replace("accident-list-homepage", "other"),
    toploHtml([]).replace("</html>", ""),
  ])("rejects an unrecognized or incomplete page", (html) => {
    expect(() => countListingIncidents(html)).toThrow();
  });

  it("rejects partially parsed incident metadata", () => {
    const html = toploHtml(["one", "two"]).replace(
      '"ContentItemId":"two"',
      '"ContentItemId":invalid',
    );

    expect(() => countListingIncidents(html)).toThrow();
  });

  it("rejects missing incident identities", () => {
    const html = toploHtml(["one"]).replace('"ContentItemId":"one"', '"ContentItemId":""');

    expect(() => countListingIncidents(html)).toThrow();
  });

  it("rejects an incident block whose structure has changed", () => {
    const html = toploHtml(["one", "two"]).replace(
      /if \(geoJsonString\)/,
      "if (changedCondition)",
    );

    expect(() => countListingIncidents(html)).toThrow();
  });

  it("rejects a mismatch between the visible list and metadata", () => {
    const html = toploHtml(["one", "two"]).replace(
      'data-accidentId="two"',
      'data-accidentId="unexpected"',
    );

    expect(() => countListingIncidents(html)).toThrow();
  });

  it("rejects a listing row without an identity", () => {
    const html = toploHtml(["one"]).replace('data-accidentId="one"', "");

    expect(() => countListingIncidents(html)).toThrow();
  });

  it("rejects attributes whose names only end with a required attribute name", () => {
    const html = toploHtml(["one"]);

    expect(() => {
      countListingIncidents(html.replace('class="accident-container"', 'data-class="accident-container"'));
    }).toThrow("does not match");
    expect(() => {
      countListingIncidents(html.replace('data-accidentId="one"', 'other-data-accidentId="one"'));
    }).toThrow("without an incident ID");
  });
});
