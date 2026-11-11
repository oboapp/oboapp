import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSourceConfiguration } from "./check-source-config";

const { metadata } = vi.hoisted(() => ({
  metadata: {
    id: "example",
    name: "Example source",
    url: "https://example.com",
    localities: ["bg.plovdiv"],
  },
}));

vi.mock("@oboapp/shared", () => ({ SOURCES: [metadata] }));

let directory: string;
let packageDirectory: string;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

function addUnselectedPackage(packageMetadata: unknown = { ...metadata, id: "other" }): void {
  const retainedDirectory = join(directory, "node_modules", "@oboapp", "source-other");
  mkdirSync(retainedDirectory, { recursive: true });
  writeJson(join(retainedDirectory, "package.json"), {
    name: "@oboapp/source-other",
    version: "1.2.3",
    exports: { ".": "./runtime.cjs", "./metadata": "./metadata.cjs" },
  });
  writeFileSync(join(retainedDirectory, "runtime.cjs"), "throw new Error('Retained runtime was loaded');");
  writeFileSync(join(retainedDirectory, "metadata.cjs"), `exports.metadata = ${JSON.stringify(packageMetadata)};`);
  writeJson(join(directory, "package.json"), {
    dependencies: {
      "@oboapp/source-example": "1.2.3",
      "@oboapp/source-other": "1.2.3",
    },
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "obo-source-selection-"));
  packageDirectory = join(directory, "node_modules", "@oboapp", "source-example");
  mkdirSync(packageDirectory, { recursive: true });
  mkdirSync(join(directory, "terraform"));
  mkdirSync(join(directory, "crawlers", metadata.id), { recursive: true });
  writeFileSync(join(directory, "crawlers", metadata.id, "index.ts"), "throw new Error('Entrypoint was loaded');");
  writeJson(join(directory, "package.json"), {
    dependencies: {
      "@oboapp/source-example": "1.2.3",
      "@oboapp/source-sdk": "0.1.1",
      "@oboapp/source-web-utils": "0.3.1",
      playwright: "1.61.1",
    },
  });
  writeJson(join(packageDirectory, "package.json"), {
    name: "@oboapp/source-example",
    version: "1.2.3",
    exports: { ".": "./runtime.cjs", "./metadata": "./metadata.cjs" },
  });
  writeFileSync(join(packageDirectory, "runtime.cjs"), "throw new Error('Provider runtime was loaded');");
  writeFileSync(join(packageDirectory, "metadata.cjs"), `exports.metadata = ${JSON.stringify(metadata)};`);
  writeJson(join(directory, "terraform", "source-jobs.bg.plovdiv.json"), {
    "plovdiv-example": { source: metadata.id, memory: "512Mi", timeout: "1800s" },
  });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("source configuration files", () => {
  it("reads dependency metadata and deployment jobs without loading runtimes or support packages", () => {
    expect(() => checkSourceConfiguration(directory, directory)).not.toThrow();
  });

  it("requires explicit retention of an installed unselected package", () => {
    addUnselectedPackage();
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(
      "@oboapp/source-other provides unselected source other",
    );
  });

  it("reads an explicit retention policy without loading the retained runtime", () => {
    addUnselectedPackage();
    writeJson(join(directory, "source-package-policy.json"), {
      retainedUnselectedPackages: ["@oboapp/source-other"],
    });
    expect(() => checkSourceConfiguration(directory, directory)).not.toThrow();
  });

  it("validates retained metadata before accepting its policy entry", () => {
    addUnselectedPackage({ id: "other" });
    writeJson(join(directory, "source-package-policy.json"), {
      retainedUnselectedPackages: ["@oboapp/source-other"],
    });
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(
      "Cannot read browser-safe source metadata from @oboapp/source-other/metadata",
    );
  });

  it("reports a stale retention entry when the package is selected", () => {
    writeJson(join(directory, "source-package-policy.json"), {
      retainedUnselectedPackages: ["@oboapp/source-example"],
    });
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(
      "Retained unselected package @oboapp/source-example is selected",
    );
  });

  it("rejects misspelled retention policy fields", () => {
    writeJson(join(directory, "source-package-policy.json"), {
      retainedUnselectedPackages: [],
      retainedUnselectedPackage: ["@oboapp/source-example"],
    });
    expect(() => checkSourceConfiguration(directory, directory)).toThrow("retainedUnselectedPackage");
  });

  it("reports a selected package with no isolated metadata export", () => {
    writeJson(join(packageDirectory, "package.json"), {
      name: "@oboapp/source-example",
      exports: { ".": "./runtime.cjs" },
    });
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(
      "Cannot read browser-safe source metadata from @oboapp/source-example/metadata",
    );
  });

  it("rejects malformed package metadata before checking the selection", () => {
    writeFileSync(join(packageDirectory, "metadata.cjs"), "exports.metadata = { id: 'example' };");
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(
      "Cannot read browser-safe source metadata from @oboapp/source-example/metadata",
    );
  });

  it("reports a removed selected entrypoint", () => {
    rmSync(join(directory, "crawlers", metadata.id, "index.ts"));
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(
      "Catalog source example has no crawler entrypoint",
    );
  });

  it("reports missing deployment data", () => {
    rmSync(join(directory, "terraform", "source-jobs.bg.plovdiv.json"));
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(
      "Catalog locality bg.plovdiv has no deployment job configuration",
    );
  });

  it("rejects misspelled deployment options", () => {
    writeJson(join(directory, "terraform", "source-jobs.bg.plovdiv.json"), {
      "plovdiv-example": { source: metadata.id, emergnt: true },
    });
    expect(() => checkSourceConfiguration(directory, directory)).toThrow("emergnt");
  });

  it.each(["memory", "timeout"])("rejects a job missing its %s setting", (field) => {
    const job: Record<string, string> = {
      source: metadata.id,
      memory: "512Mi",
      timeout: "1800s",
    };
    delete job[field];
    writeJson(join(directory, "terraform", "source-jobs.bg.plovdiv.json"), {
      "plovdiv-example": job,
    });
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(field);
  });

  it("rejects malformed deployment JSON", () => {
    writeFileSync(join(directory, "terraform", "source-jobs.bg.plovdiv.json"), "{");
    expect(() => checkSourceConfiguration(directory, directory)).toThrow(SyntaxError);
  });

  it("ignores unrelated Terraform JSON files", () => {
    writeJson(join(directory, "terraform", "terraform.tfvars.json"), { unrelated: true });
    expect(() => checkSourceConfiguration(directory, directory)).not.toThrow();
  });

  it("keeps example jobs outside the active deployment selection", () => {
    const exampleDirectory = join(directory, "terraform", "examples");
    mkdirSync(exampleDirectory);
    writeJson(join(exampleDirectory, "source-jobs.bg.sofia.json"), {
      unselected: { source: "other", memory: "512Mi", timeout: "1800s" },
    });
    expect(() => checkSourceConfiguration(directory, directory)).not.toThrow();
  });
});
