import { describe, it, expect } from "vitest";
import { normalizePinAddress } from "./normalize-address";

describe("normalizePinAddress", () => {
  it("lowercases the address", () => {
    expect(normalizePinAddress("Витоша")).toBe("витоша");
  });

  it("strips бул. prefix", () => {
    expect(normalizePinAddress("бул. Витоша")).toBe("витоша");
    expect(normalizePinAddress("бул.Витоша")).toBe("витоша");
  });

  it("strips ул. prefix", () => {
    expect(normalizePinAddress("ул. Граф Игнатиев")).toBe("граф игнатиев");
    expect(normalizePinAddress("ул.Граф Игнатиев")).toBe("граф игнатиев");
  });

  it("strips площад / пл. prefix", () => {
    expect(normalizePinAddress("площад Славейков")).toBe("славейков");
    expect(normalizePinAddress("пл. Славейков")).toBe("славейков");
  });

  it("strips ordinal suffixes from numbers", () => {
    expect(normalizePinAddress("20-ти септември")).toBe("20 септември");
    expect(normalizePinAddress("3-ти март")).toBe("3 март");
    expect(normalizePinAddress("8-ми март")).toBe("8 март");
    expect(normalizePinAddress("1-ви май")).toBe("1 май");
    expect(normalizePinAddress("2-ри юни")).toBe("2 юни");
  });

  it("removes ASCII double quotes", () => {
    expect(normalizePinAddress('ул. "Дондуков"')).toBe("дондуков");
  });

  it("removes typographic quotes", () => {
    // Use single-quoted strings so U+201D (looks like ") doesn't close the literal
    expect(
      normalizePinAddress(
        "ул. \u201e\u0414\u043e\u043d\u0434\u0443\u043a\u043e\u0432\u201d",
      ),
    ).toBe("\u0434\u043e\u043d\u0434\u0443\u043a\u043e\u0432");
    expect(
      normalizePinAddress(
        "ул. \u00ab\u0414\u043e\u043d\u0434\u0443\u043a\u043e\u0432\u00bb",
      ),
    ).toBe("\u0434\u043e\u043d\u0434\u0443\u043a\u043e\u0432");
  });

  it("adds space after dot-letter abbreviations", () => {
    expect(normalizePinAddress("Г.С.Раковски")).toBe("г. с. раковски");
  });

  it("collapses multiple whitespace characters", () => {
    expect(normalizePinAddress("ул.  Граф  Игнатиев")).toBe("граф игнатиев");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePinAddress("  Витоша  ")).toBe("витоша");
  });

  it("returns an already-normalized string unchanged", () => {
    expect(normalizePinAddress("граф игнатиев")).toBe("граф игнатиев");
  });

  it("normalizes a street name the same way as an address", () => {
    // Street names use the same function as pin addresses — the cache key
    // is just the normalized street name, not a composite with endpoints.
    expect(normalizePinAddress("бул. Витоша")).toBe("витоша");
    expect(normalizePinAddress("ул. Граф Игнатиев")).toBe("граф игнатиев");
    expect(normalizePinAddress("ул. 20-ти Април")).toBe("20 април");
  });
});
