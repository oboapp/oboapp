// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readInstalledPackageManifest, readInstalledSourcePackages } from "./installed-packages";

const packageName = "@oboapp/source-example";
const metadata = {
  id: "city-bulletins",
  name: "City bulletins",
  url: "https://example.com/news",
  localities: ["bg.plovdiv"],
};
let directory: string;
let packageDirectory: string;
let metadataPath: string;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

function writeManifest(dependencies?: unknown): void {
  writeJson(join(packageDirectory, "package.json"), {
    name: packageName,
    dependencies,
    exports: { ".": "./dist/cjs/runtime.cjs", "./metadata": "./dist/cjs/metadata.cjs" },
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "obo-installed-sources-"));
  packageDirectory = join(directory, "node_modules", packageName);
  const compiledDirectory = join(packageDirectory, "dist", "cjs");
  mkdirSync(compiledDirectory, { recursive: true });
  metadataPath = join(compiledDirectory, "metadata.cjs");
  writeJson(join(compiledDirectory, "package.json"), { type: "commonjs" });
  writeFileSync(metadataPath, `exports.metadata = ${JSON.stringify(metadata)};`);
  writeFileSync(join(compiledDirectory, "runtime.cjs"), "throw new Error('Source runtime was loaded');");
  writeManifest({ "@oboapp/source-web-utils": "0.3.1" });
  writeJson(join(directory, "package.json"), {
    dependencies: {
      [packageName]: "1.2.3",
      "@oboapp/source-sdk": "0.1.1",
      "@oboapp/source-web-utils": "0.3.1",
      "other-library": "1.2.3",
    },
  });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("installed source package metadata", () => {
  it("reads isolated metadata and declared dependencies without loading runtimes or support packages", () => {
    expect(readInstalledSourcePackages(directory)).toEqual([{
      name: packageName,
      version: "1.2.3",
      metadata,
      directory: packageDirectory,
      dependencies: { "@oboapp/source-web-utils": "0.3.1" },
    }]);
  });

  it("finds the owning named manifest beyond nested module-type manifests", () => {
    expect(readInstalledPackageManifest(packageName, metadataPath)).toEqual({
      directory: packageDirectory,
      dependencies: { "@oboapp/source-web-utils": "0.3.1" },
    });
  });

  it("requires the matching package name when walking manifests", () => {
    expect(() => readInstalledPackageManifest("@oboapp/source-missing", metadataPath)).toThrow(
      "Cannot find installed package manifest for @oboapp/source-missing",
    );
  });

  it("supports source packages without production dependencies", () => {
    writeManifest();

    expect(readInstalledSourcePackages(directory)[0].dependencies).toEqual({});
  });

  it("rejects malformed declared dependencies with the source package context", () => {
    writeManifest({ playwright: 123 });

    expect(() => readInstalledSourcePackages(directory)).toThrow(
      `Cannot read browser-safe source metadata from ${packageName}/metadata`,
    );
  });

  it("supports a manifest containing only non-source dependencies", () => {
    writeJson(join(directory, "package.json"), {
      dependencies: { "@oboapp/source-sdk": "0.1.1", "other-library": "1.2.3" },
    });

    expect(readInstalledSourcePackages(directory)).toEqual([]);
  });
});
