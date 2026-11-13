// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSelectedSources, createSelectedBuildConfig } from "./build-selected-sources";

let directory: string;

function writeFixture(path: string, content: string): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function removeFixture(path: string): void {
  const target = resolve(directory, path);
  if (!target.startsWith(`${resolve(directory)}${sep}`)) {
    throw new Error("Refusing to remove a path outside the build fixture");
  }
  rmSync(target, { recursive: true, force: true });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "obo-selected-build-"));
  writeFixture("package.json", JSON.stringify({ name: "selected-build-fixture", private: true }));
  writeFixture("tsconfig.build.json", JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "commonjs",
      moduleResolution: "node",
      rootDir: ".",
      outDir: "dist",
      strict: true,
      types: [],
      skipLibCheck: true,
    },
    include: ["**/*.ts"],
    exclude: ["node_modules", "dist", "**/*.test.ts"],
  }));
  writeFixture("crawl.ts", "export const command = 'selected sources';");
  writeFixture("runtime.ts", [
    "import { value } from './__mocks__/runtime-value';",
    "export const runtimeValue = value;",
  ].join("\n"));
  writeFixture("__mocks__/runtime-value.ts", "export const value = 'runtime fixture';");
  writeFixture("__mocks__/legacy-types.ts", [
    "export type { LegacyRecord } from '../crawlers/sofia-other';",
  ].join("\n"));
  writeFixture("crawlers/shared/helper.ts", [
    "export function content(): string {",
    "  return 'legacy content';",
    "}",
  ].join("\n"));
  writeFixture("crawlers/plovdiv-news/index.ts", [
    "import { content } from '../shared/helper';",
    "export function crawl(): string {",
    "  return content();",
    "}",
  ].join("\n"));
  writeFixture("crawlers/plovdiv-news/unused.ts", "export const unused: number = 'not an imported dependency';");
  writeFixture("crawlers/plovdiv-water/index.ts", [
    "import { fetchItem } from '@oboapp/source-plovdiv-water';",
    "export async function crawl(): Promise<string> {",
    "  return fetchItem();",
    "}",
  ].join("\n"));
  writeFixture("crawlers/sofia-other/index.ts", [
    "export interface LegacyRecord { identifier: string; }",
    "export const invalid: number = 'unselected source must not compile';",
  ].join("\n"));
  writeFixture("node_modules/@oboapp/source-plovdiv-water/package.json", JSON.stringify({
    name: "@oboapp/source-plovdiv-water",
    version: "1.0.0",
    main: "index.js",
    types: "index.d.ts",
  }));
  writeFixture("node_modules/@oboapp/source-plovdiv-water/index.d.ts", "export function fetchItem(): Promise<string>;");
  writeFixture("node_modules/@oboapp/source-plovdiv-water/index.js", [
    "exports.fetchItem = async function () {",
    "  return 'packaged content';",
    "};",
  ].join("\n"));
});

afterEach(() => {
  const fixturePath = resolve(directory);
  const temporaryRoot = `${resolve(tmpdir())}${sep}`;
  if (!fixturePath.startsWith(temporaryRoot)) {
    throw new Error("Refusing to remove a fixture outside the temporary directory");
  }
  rmSync(fixturePath, { recursive: true, force: true });
});

describe("selected source production build", () => {
  it("uses ordinary runtime roots and explicitly selected entrypoints", () => {
    const config = createSelectedBuildConfig(directory, ["plovdiv-news", "plovdiv-water"]);
    const roots = config.fileNames.map((fileName) => resolve(fileName));

    expect(roots).toEqual(expect.arrayContaining([
      join(directory, "crawl.ts"),
      join(directory, "runtime.ts"),
      join(directory, "crawlers", "plovdiv-news", "index.ts"),
      join(directory, "crawlers", "plovdiv-water", "index.ts"),
    ]));
    expect(roots).not.toContain(join(directory, "crawlers", "sofia-other", "index.ts"));
    expect(roots).not.toContain(join(directory, "crawlers", "plovdiv-news", "unused.ts"));
    expect(roots).not.toContain(join(directory, "crawlers", "shared", "helper.ts"));
    expect(roots).not.toContain(join(directory, "__mocks__", "legacy-types.ts"));
  });

  it("compiles selected legacy and package adapters with their imported helpers and runtime fixtures", async () => {
    buildSelectedSources(directory, ["plovdiv-news", "plovdiv-water"]);

    const fixtureRequire = createRequire(join(directory, "package.json"));
    const legacy: { crawl: () => string } = fixtureRequire("./dist/crawlers/plovdiv-news/index.js");
    const packaged: { crawl: () => Promise<string> } = fixtureRequire("./dist/crawlers/plovdiv-water/index.js");
    const runtime: { runtimeValue: string } = fixtureRequire("./dist/runtime.js");
    expect(legacy.crawl()).toBe("legacy content");
    await expect(packaged.crawl()).resolves.toBe("packaged content");
    expect(runtime.runtimeValue).toBe("runtime fixture");
    expect(existsSync(join(directory, "dist", "crawlers", "shared", "helper.js"))).toBe(true);
    expect(existsSync(join(directory, "dist", "__mocks__", "runtime-value.js"))).toBe(true);
    expect(existsSync(join(directory, "dist", "__mocks__", "legacy-types.js"))).toBe(false);
    expect(existsSync(join(directory, "dist", "crawlers", "sofia-other"))).toBe(false);
    expect(existsSync(join(directory, "dist", "crawlers", "plovdiv-news", "unused.js"))).toBe(false);
  });

  it("removes stale output from earlier source selections before compiling", () => {
    writeFixture("dist/crawlers/sofia-old/index.js", "throw new Error('Stale source');");
    writeFixture("dist/stale.js", "throw new Error('Stale output');");

    buildSelectedSources(directory, ["plovdiv-news"]);

    expect(existsSync(join(directory, "dist", "stale.js"))).toBe(false);
    expect(existsSync(join(directory, "dist", "crawlers", "sofia-old"))).toBe(false);
    expect(existsSync(join(directory, "dist", "crawlers", "plovdiv-water"))).toBe(false);
    expect(readFileSync(join(directory, "dist", "crawlers", "plovdiv-news", "index.js"), "utf8")).toContain("crawl");
  });

  it("reports a missing selected entrypoint", () => {
    expect(() => createSelectedBuildConfig(directory, ["plovdiv-missing"])).toThrow(/plovdiv-missing/);
  });

  it.each(["", ".", "..", "shared", "../sofia-other", "plovdiv/news", "plovdiv\\news"])(
    "rejects the unsafe source ID %j",
    (sourceId) => {
      expect(() => createSelectedBuildConfig(directory, [sourceId])).toThrow("Invalid selected source ID");
    },
  );

  it("rejects a duplicate selected entrypoint", () => {
    expect(() => createSelectedBuildConfig(directory, ["plovdiv-news", "plovdiv-news"])).toThrow(
      "Duplicate selected source ID: plovdiv-news",
    );
  });

  it("preserves existing files when the configured output directory is unsafe", () => {
    const config: { compilerOptions: Record<string, unknown> } = JSON.parse(
      readFileSync(join(directory, "tsconfig.build.json"), "utf8"),
    );
    config.compilerOptions.outDir = "other-output";
    writeFixture("tsconfig.build.json", JSON.stringify(config));
    writeFixture("other-output/keep.txt", "Existing files must remain");
    writeFixture("dist/keep.txt", "The previous build must remain");

    expect(() => buildSelectedSources(directory, ["plovdiv-news"])).toThrow(/outDir/);

    expect(readFileSync(join(directory, "other-output", "keep.txt"), "utf8")).toBe("Existing files must remain");
    expect(readFileSync(join(directory, "dist", "keep.txt"), "utf8")).toBe("The previous build must remain");
  });

  it("builds a packaged Plovdiv instance with unselected collector directories absent", async () => {
    removeFixture("crawlers/sofia-other");
    removeFixture("crawlers/plovdiv-news");

    buildSelectedSources(directory, ["plovdiv-water"]);

    const fixtureRequire = createRequire(join(directory, "package.json"));
    const packaged: { crawl: () => Promise<string> } = fixtureRequire("./dist/crawlers/plovdiv-water/index.js");
    await expect(packaged.crawl()).resolves.toBe("packaged content");
    expect(existsSync(join(directory, "dist", "crawlers", "plovdiv-news"))).toBe(false);
    expect(existsSync(join(directory, "dist", "crawlers", "sofia-other"))).toBe(false);
  });

  it("rejects a selected collector that imports an unselected implementation", () => {
    writeFixture("crawlers/plovdiv-news/index.ts", [
      "import type { LegacyRecord } from '../sofia-other';",
      "export function crawl(item: LegacyRecord): string {",
      "  return item.identifier;",
      "}",
    ].join("\n"));

    expect(() => buildSelectedSources(directory, ["plovdiv-news"])).toThrow(/unselected|not selected/i);
    expect(existsSync(join(directory, "dist", "crawlers", "sofia-other"))).toBe(false);
  });
});
