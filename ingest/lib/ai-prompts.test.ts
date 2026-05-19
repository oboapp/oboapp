import { describe, it, expect } from "vitest";

import { buildPromptExtras } from "./ai-prompts";
import type { PromptContext } from "./ai-prompts";

describe("buildPromptExtras()", () => {
  it("formats the date as DD.MM.YYYY using local time", () => {
    const ctx: PromptContext = { currentDate: new Date(2026, 4, 19) }; // May 19 2026
    const extras = buildPromptExtras(ctx);
    expect(extras["{{CURRENT_DATE}}"]).toBe("19.05.2026");
  });

  it("zero-pads single-digit day and month", () => {
    const ctx: PromptContext = { currentDate: new Date(2026, 2, 7) }; // March 7 2026
    const extras = buildPromptExtras(ctx);
    expect(extras["{{CURRENT_DATE}}"]).toBe("07.03.2026");
  });

  it("includes sourceType in {{SOURCE_NAME}}", () => {
    const ctx: PromptContext = {
      currentDate: new Date(2026, 4, 19),
      sourceType: "sdvr-mvr-bg",
    };
    const extras = buildPromptExtras(ctx);
    expect(extras["{{SOURCE_NAME}}"]).toBe("sdvr-mvr-bg");
  });

  it("defaults {{SOURCE_NAME}} to empty string when sourceType is absent", () => {
    const ctx: PromptContext = { currentDate: new Date(2026, 4, 19) };
    const extras = buildPromptExtras(ctx);
    expect(extras["{{SOURCE_NAME}}"]).toBe("");
  });

  it("includes sourceUrl in {{SOURCE_URL}}", () => {
    const ctx: PromptContext = {
      currentDate: new Date(2026, 4, 19),
      sourceUrl: "https://www.mvr.bg/sdvr",
    };
    const extras = buildPromptExtras(ctx);
    expect(extras["{{SOURCE_URL}}"]).toBe("https://www.mvr.bg/sdvr");
  });

  it("defaults {{SOURCE_URL}} to empty string when sourceUrl is absent", () => {
    const ctx: PromptContext = { currentDate: new Date(2026, 4, 19) };
    const extras = buildPromptExtras(ctx);
    expect(extras["{{SOURCE_URL}}"]).toBe("");
  });

  it("returns all three placeholder keys", () => {
    const ctx: PromptContext = { currentDate: new Date(2026, 4, 19) };
    const extras = buildPromptExtras(ctx);
    expect(Object.keys(extras)).toEqual(
      expect.arrayContaining([
        "{{CURRENT_DATE}}",
        "{{SOURCE_NAME}}",
        "{{SOURCE_URL}}",
      ]),
    );
  });
});
