import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_YAML = `
city: TestCity
country: TestCountry
primary-language: TestLang
districts:
  - District1
  - District2
address-hints: near the main road
`.trim();

let tempDir: string;
let localitiesDir: string;

beforeEach(() => {
  // Reset module cache so the per-module singleton (cachedContext) starts null
  vi.resetModules();

  tempDir = mkdtempSync(join(tmpdir(), "locality-ctx-test-"));
  localitiesDir = join(tempDir, "prompts", "localities");
  mkdirSync(localitiesDir, { recursive: true });

  // Redirect process.cwd() so loadLocalityContext() resolves paths into tempDir
  vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  process.env.LOCALITY = "test.locality";
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.LOCALITY;
});

describe("applyLocalityContext()", () => {
  it("substitutes all supported placeholders", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(
      applyLocalityContext("{{CITY}}, {{COUNTRY}} ({{PRIMARY_LANGUAGE}})"),
    ).toBe("TestCity, TestCountry (TestLang)");
  });

  it("joins {{DISTRICTS}} with ', '", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(applyLocalityContext("{{DISTRICTS}}")).toBe("District1, District2");
  });

  it("substitutes {{ADDRESS_HINTS}}", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(applyLocalityContext("{{ADDRESS_HINTS}}")).toBe(
      "near the main road",
    );
  });

  it("returns template unchanged when no placeholders are present", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(applyLocalityContext("no placeholders here")).toBe(
      "no placeholders here",
    );
  });

  it("throws on any unresolved {{PLACEHOLDER}}", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(() => applyLocalityContext("{{UNKNOWN_KEY}}")).toThrow(
      /unresolved placeholders.*\{\{UNKNOWN_KEY\}\}/i,
    );
  });

  it("applies extraSubstitutions alongside locality placeholders", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(
      applyLocalityContext("{{CITY}} - {{CURRENT_DATE}}", {
        "{{CURRENT_DATE}}": "19.05.2026",
      }),
    ).toBe("TestCity - 19.05.2026");
  });

  it("extraSubstitutions prevent unresolved placeholder error", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(() =>
      applyLocalityContext("{{DYNAMIC_KEY}}", { "{{DYNAMIC_KEY}}": "value" }),
    ).not.toThrow();
  });

  it("extraSubstitutions can override locality placeholders", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { applyLocalityContext } = await import("./locality-context");

    expect(
      applyLocalityContext("{{CITY}}", { "{{CITY}}": "OverrideCity" }),
    ).toBe("OverrideCity");
  });
});

describe("loadLocalityContext() error handling", () => {
  it("throws a file-not-found error for ENOENT - not a generic message", async () => {
    // Do NOT write the YAML file => real readFileSync throws ENOENT
    const { applyLocalityContext } = await import("./locality-context");

    expect(() => applyLocalityContext("{{CITY}}")).toThrow(
      /Locality context file not found for "test\.locality"/,
    );
  });

  it("includes hint to create the file in the ENOENT message", async () => {
    const { applyLocalityContext } = await import("./locality-context");

    expect(() => applyLocalityContext("{{CITY}}")).toThrow(
      /Create prompts\/localities\/test\.locality\.yaml/,
    );
  });

  it("throws a distinct 'Invalid YAML' error for YAML parse failures", async () => {
    writeFileSync(
      join(localitiesDir, "test.locality.yaml"),
      "{ invalid yaml {{{",
    );
    const { applyLocalityContext } = await import("./locality-context");

    expect(() => applyLocalityContext("{{CITY}}")).toThrow(/Invalid YAML/);
  });

  it("throws a schema validation error when required fields are missing", async () => {
    // Valid YAML but missing primary-language, districts, address-hints
    writeFileSync(
      join(localitiesDir, "test.locality.yaml"),
      "city: TestCity\ncountry: TestCountry",
    );
    const { applyLocalityContext } = await import("./locality-context");

    expect(() => applyLocalityContext("{{CITY}}")).toThrow(
      /Invalid locality context file/,
    );
  });
});
