// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareSourceImageFixture } from "./prepare-source-image-fixture";

const selectedPackage = "@oboapp/source-triaditsa-org";
const unselectedPackage = "@oboapp/source-mladost-bg";
const optionalPackage = "@oboapp/source-other-city";
const canonicalJobs = {
  "triaditsa-existing-key": {
    source: "triaditsa-org", memory: "768Mi", timeout: "1200s", description: "Existing district job",
  },
  "water-existing-key": {
    source: "sofiyska-voda", memory: "512Mi", timeout: "1800s", emergent: true,
  },
  mladost: { source: "mladost-bg", memory: "1Gi", timeout: "1800s" },
};
let directory: string;
let repository: string;
let target: string;

function writeFile(path: string, content: string): void {
  const destination = join(repository, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function writeJson(path: string, value: unknown): void {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(target, path), "utf8"));
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "obo-source-image-context-"));
  repository = join(directory, "repo");
  target = join(directory, "context");
  writeJson("package.json", { name: "image-fixture-repo", packageManager: "pnpm@10.11.0" });
  writeFile("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  writeFile("pnpm-workspace.yaml", "packages:\n  - ingest\n  - shared\n  - db\n");
  writeFile(".dockerignore", "**/node_modules/\n**/.env*\n");
  writeFile("patches/source.patch", "Patch bytes\r\n");
  writeJson("ingest/package.json", {
    name: "oboapp-ingest",
    dependencies: { [selectedPackage]: "0.2.0", [unselectedPackage]: "0.1.1", "@oboapp/source-sdk": "0.1.1" },
    devDependencies: { vitest: "4.0.18" },
    optionalDependencies: { [optionalPackage]: "0.1.0" },
  });
  writeFile("shared/src/sources.ts", "Original instance assembly\n");
  writeFile("shared/src/sources/triaditsa-org.ts", "export default { id: 'triaditsa-org' };\n");
  writeFile("shared/src/sources/sofiyska-voda.ts", "export default { id: 'sofiyska-voda', emergent: true };\n");
  writeFile("shared/src/sources/mladost-bg.ts", "Metadata definition remains available\n");
  writeJson("shared/package.json", { name: "@oboapp/shared" });
  writeJson("db/package.json", { name: "@oboapp/db" });
  writeFile("ingest/Dockerfile", "FROM node:20-slim\n");
  writeFile("ingest/crawlers/shared/helper.ts", "Shared helper\n");
  for (const id of ["triaditsa-org", "sofiyska-voda", "mladost-bg", "other-city"]) {
    writeFile(`ingest/crawlers/${id}/index.ts`, `Source entrypoint ${id}\n`);
  }
  writeJson("ingest/terraform/examples/source-jobs.bg.sofia.json", canonicalJobs);
  writeJson("ingest/terraform/source-jobs.bg.sofia.json", { original: { source: "mladost-bg" } });
  writeJson("ingest/terraform/source-jobs.bg.plovdiv.json", { extra: { source: "other-city" } });
  writeFile("ingest/terraform/main.tf", "Existing Terraform logic\n");
  writeJson("ingest/source-package-policy.json", { retainedUnselectedPackages: ["original-policy"] });
  for (const [name, id] of [
    [selectedPackage, "triaditsa-org"],
    [unselectedPackage, "mladost-bg"],
    [optionalPackage, "other-city"],
  ]) {
    writeJson(`ingest/node_modules/${name}/package.json`, {
      name,
      exports: { ".": "./runtime.cjs", "./metadata": "./metadata.cjs" },
    });
    writeFile(`ingest/node_modules/${name}/metadata.cjs`, `exports.metadata = ${JSON.stringify({
      id, name: id, url: `https://example.com/${id}`, localities: ["bg.sofia"],
    })};`);
    writeFile(`ingest/node_modules/${name}/runtime.cjs`, "throw new Error('Provider runtime was loaded');");
  }
  for (const project of ["shared", "db", "ingest"]) {
    for (const relativePath of [
      "node_modules/private.txt", "dist/old.js", "tmp/cache.txt", "coverage/report.json",
      ".terraform/state", ".cache/data", "__tests__/contract.ts", "tests/private.ts",
      "src/feature.test.ts", "src/feature.spec.ts", ".env.local", ".env.example",
    ]) {
      writeFile(`${project}/${relativePath}`, "Excluded fixture data\n");
    }
  }
  writeFile("ingest/terraform/terraform.tfvars", "private project values\n");
  writeFile("ingest/terraform/secrets.auto.tfvars.json", "private automatic values\n");
  writeFile("ingest/terraform/terraform.tfstate", "private infrastructure state\n");
});

afterEach(() => {
  const fixturePath = resolve(directory);
  if (!fixturePath.startsWith(`${resolve(tmpdir())}${sep}`)) {
    throw new Error("Refusing to remove an image fixture outside the temporary directory");
  }
  rmSync(fixturePath, { recursive: true, force: true });
});

describe("minimal source image fixture", () => {
  it("copies only selected crawler implementations and keeps developer package inputs unchanged", () => {
    const originalPaths = [
      "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "ingest/package.json",
      "shared/src/sources.ts", "ingest/source-package-policy.json", "ingest/crawlers/mladost-bg/index.ts",
    ];
    const before = originalPaths.map((path) => readFileSync(join(repository, path)));

    prepareSourceImageFixture(repository, target);

    expect(readdirSync(join(target, "ingest", "crawlers")).sort()).toEqual([
      "shared", "sofiyska-voda", "triaditsa-org",
    ]);
    expect(readFileSync(join(target, "ingest", "package.json"))).toEqual(before[3]);
    expect(readFileSync(join(target, "pnpm-lock.yaml"))).toEqual(before[1]);
    expect(readFileSync(join(target, "pnpm-workspace.yaml"))).toEqual(before[2]);
    expect(readFileSync(join(target, "patches", "source.patch"))).toEqual(
      readFileSync(join(repository, "patches", "source.patch")),
    );
    expect(readJson("ingest/source-package-policy.json")).toEqual({
      retainedUnselectedPackages: [unselectedPackage, optionalPackage],
    });
    expect(originalPaths.map((path) => readFileSync(join(repository, path)))).toEqual(before);
  });

  it("uses real source definition imports and derives the emergent group", () => {
    prepareSourceImageFixture(repository, target);

    const assembly = readFileSync(join(target, "shared", "src", "sources.ts"), "utf8");
    expect(assembly).toContain('from "./sources/triaditsa-org"');
    expect(assembly).toContain('from "./sources/sofiyska-voda"');
    expect(assembly).toContain(".filter((source) => source.emergent)");
    for (const id of ["triaditsa-org", "sofiyska-voda"]) {
      expect(readFileSync(join(target, "shared", "src", "sources", `${id}.ts`))).toEqual(
        readFileSync(join(repository, "shared", "src", "sources", `${id}.ts`)),
      );
    }
  });

  it("preserves canonical job keys and settings while replacing every active locality job file", () => {
    prepareSourceImageFixture(repository, target);

    const activeFiles = readdirSync(join(target, "ingest", "terraform"))
      .filter((name) => name.startsWith("source-jobs."));
    expect(activeFiles).toEqual(["source-jobs.bg.sofia.json"]);
    expect(readJson("ingest/terraform/source-jobs.bg.sofia.json")).toEqual({
      "triaditsa-existing-key": canonicalJobs["triaditsa-existing-key"],
      "water-existing-key": canonicalJobs["water-existing-key"],
    });
    expect(readJson("ingest/terraform/examples/source-jobs.bg.sofia.json")).toEqual(canonicalJobs);
  });

  it("omits installed dependencies, build output, tests, environment files and local infrastructure state", () => {
    prepareSourceImageFixture(repository, target);

    for (const project of ["shared", "db", "ingest"]) {
      for (const relativePath of [
        "node_modules", "dist", "tmp", "coverage", ".terraform", ".cache", "__tests__", "tests",
        "src/feature.test.ts", "src/feature.spec.ts", ".env.local", ".env.example",
      ]) {
        expect(existsSync(join(target, project, relativePath)), `${project}/${relativePath}`).toBe(false);
      }
    }
    for (const name of ["terraform.tfvars", "secrets.auto.tfvars.json", "terraform.tfstate"]) {
      expect(existsSync(join(target, "ingest", "terraform", name)), name).toBe(false);
      expect(existsSync(join(repository, "ingest", "terraform", name)), name).toBe(true);
    }
  });

  it("refuses an occupied target without changing its files", () => {
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "Existing context");

    expect(() => prepareSourceImageFixture(repository, target)).toThrow(/new or empty/);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("Existing context");
  });

  it("refuses a source directory target", () => {
    const sourceTarget = join(repository, "shared");

    expect(() => prepareSourceImageFixture(repository, sourceTarget)).toThrow(/inside the repository/);
    expect(readFileSync(join(sourceTarget, "src", "sources.ts"), "utf8")).toBe("Original instance assembly\n");
  });

  it("fails before writing output when a selected canonical job is missing", () => {
    writeJson("ingest/terraform/examples/source-jobs.bg.sofia.json", {
      water: canonicalJobs["water-existing-key"],
    });

    expect(() => prepareSourceImageFixture(repository, target)).toThrow(/triaditsa-org/);
    expect(existsSync(target)).toBe(false);
  });
});
