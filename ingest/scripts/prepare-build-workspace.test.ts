// @vitest-environment node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { dump, load } from "js-yaml";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const bootstrapScript = join(__dirname, "prepare-build-workspace.mjs");
const selectedPackage = "@oboapp/source-plovdiv-news";
const retainedPackage = "@oboapp/source-sofia-news";
const optionalPackage = "@oboapp/source-sofia-water";
const patchBytes = Uint8Array.from([0, 13, 10, 65, 255]);
const sourceFiles = [
  "package.json",
  "ingest/package.json",
  "shared/package.json",
  "db/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "ingest/source-package-policy.json",
  "patches/source.patch",
];
let directory: string;
let repository: string;
let target: string;
let prepareBuildWorkspace: (repoDirectory: string, targetDirectory: string) => void;

interface LockedDependency {
  specifier: string;
  version: string;
}

interface LockfileImporter {
  dependencies?: Record<string, LockedDependency>;
  devDependencies?: Record<string, LockedDependency>;
  optionalDependencies?: Record<string, LockedDependency>;
}

interface FixtureLockfile {
  importers: Record<string, LockfileImporter>;
}

function writeRepositoryFile(path: string, contents: string | Uint8Array): void {
  const destination = join(repository, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function writeRepositoryJson(path: string, contents: unknown): void {
  writeRepositoryFile(path, `${JSON.stringify(contents, null, 2)}\n`);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function prepareWorkspace(outputDirectory = target): { status: number; stderr: string; error?: Error } {
  try {
    prepareBuildWorkspace(repository, outputDirectory);
    return { status: 0, stderr: "" };
  } catch (error) {
    return { status: 1, stderr: String(error) };
  }
}

function expectFailure(diagnostic: RegExp, outputDirectory = target): void {
  const result = prepareWorkspace(outputDirectory);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(diagnostic);
}

beforeAll(async () => {
  const bootstrap = await import(pathToFileURL(bootstrapScript).href);
  prepareBuildWorkspace = bootstrap.prepareBuildWorkspace;
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "obo-build-workspace-"));
  repository = join(directory, "repo");
  target = join(directory, "output");
  writeRepositoryJson("package.json", {
    name: "oboapp",
    private: true,
    packageManager: "pnpm@10.11.0",
    devDependencies: { "js-yaml": "^4.1.1", typescript: "^5" },
    pnpm: {
      overrides: { "some-transitive-package": "^2.0.0" },
      patchedDependencies: { [`${selectedPackage}@1.2.3`]: "patches/source.patch" },
    },
  });
  writeRepositoryJson("ingest/package.json", {
    name: "oboapp-ingest",
    scripts: { build: "compile-selected-sources" },
    dependencies: {
      [selectedPackage]: "1.2.3",
      [retainedPackage]: "0.1.0",
      "@oboapp/source-sdk": "0.1.1",
      "@oboapp/db": "workspace:*",
      "@oboapp/shared": "workspace:*",
    },
    devDependencies: { [retainedPackage]: "0.1.0", vitest: "4.0.18" },
    optionalDependencies: { [optionalPackage]: "0.2.0", "native-helper": "1.0.0" },
  });
  writeRepositoryJson("shared/package.json", { name: "@oboapp/shared" });
  writeRepositoryJson("db/package.json", { name: "@oboapp/db" });
  writeRepositoryFile("pnpm-workspace.yaml", dump({
    packages: ["api", "web", "ingest", "shared", "db"],
    onlyBuiltDependencies: ["esbuild"],
    catalogs: { tooling: { typescript: "^5" } },
  }));
  writeRepositoryFile("pnpm-lock.yaml", dump({
    lockfileVersion: "9.0",
    settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
    overrides: { "some-transitive-package": "^2.0.0" },
    patchedDependencies: {
      [`${selectedPackage}@1.2.3`]: { hash: "exact-patch-hash", path: "patches/source.patch" },
    },
    importers: {
      ".": {
        devDependencies: {
          "js-yaml": { specifier: "^4.1.1", version: "4.1.1" },
          typescript: { specifier: "^5", version: "5.9.3" },
        },
      },
      ingest: {
        dependencies: {
          [selectedPackage]: { specifier: "1.2.3", version: "1.2.3(patch_hash=exact-patch-hash)(zod@4.3.6)" },
          [retainedPackage]: { specifier: "0.1.0", version: "0.1.0" },
          "@oboapp/source-sdk": { specifier: "0.1.1", version: "0.1.1" },
          "@oboapp/db": { specifier: "workspace:*", version: "link:../db" },
          "@oboapp/shared": { specifier: "workspace:*", version: "link:../shared" },
        },
        devDependencies: {
          [retainedPackage]: { specifier: "0.1.0", version: "0.1.0" },
          vitest: { specifier: "4.0.18", version: "4.0.18(@types/node@20.19.33)" },
        },
        optionalDependencies: {
          [optionalPackage]: { specifier: "0.2.0", version: "0.2.0" },
          "native-helper": { specifier: "1.0.0", version: "1.0.0" },
        },
      },
      shared: {},
      db: {},
      web: { dependencies: { next: { specifier: "^16", version: "16.0.10" } } },
      api: {},
    },
    packages: {
      [`${selectedPackage}@1.2.3`]: { resolution: { integrity: "sha512-exact==" } },
      [`${retainedPackage}@0.1.0`]: { resolution: { integrity: "sha512-retained==" } },
    },
    snapshots: {
      [`${selectedPackage}@1.2.3(patch_hash=exact-patch-hash)(zod@4.3.6)`]: {
        dependencies: { zod: "4.3.6" },
      },
    },
  }));
  writeRepositoryJson("ingest/source-package-policy.json", {
    retainedUnselectedPackages: [retainedPackage, optionalPackage],
  });
  writeRepositoryFile("patches/source.patch", patchBytes);
});

afterEach(() => {
  const fixturePath = resolve(directory);
  if (!fixturePath.startsWith(`${resolve(tmpdir())}${sep}`)) {
    throw new Error("Refusing to remove a build fixture outside the temporary directory");
  }
  rmSync(fixturePath, { recursive: true, force: true });
});

describe("build workspace bootstrap", () => {
  it("projects installation inputs before providers or shared output are installed", () => {
    const originals = sourceFiles.map((path) => readFileSync(join(repository, path)));
    const originalLockfile = load(readFileSync(join(repository, "pnpm-lock.yaml"), "utf8")) as FixtureLockfile;

    const result = prepareWorkspace();

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(target).sort()).toEqual([
      "db", "ingest", "package.json", "patches", "pnpm-lock.yaml", "pnpm-workspace.yaml", "shared",
    ]);
    expect(readJson(join(target, "ingest", "package.json"))).toEqual({
      name: "oboapp-ingest",
      scripts: { build: "compile-selected-sources" },
      dependencies: {
        [selectedPackage]: "1.2.3",
        "@oboapp/source-sdk": "0.1.1",
        "@oboapp/db": "workspace:*",
        "@oboapp/shared": "workspace:*",
      },
      devDependencies: { vitest: "4.0.18" },
      optionalDependencies: { "native-helper": "1.0.0" },
    });
    delete originalLockfile.importers.web;
    delete originalLockfile.importers.api;
    delete originalLockfile.importers.ingest.dependencies?.[retainedPackage];
    delete originalLockfile.importers.ingest.devDependencies?.[retainedPackage];
    delete originalLockfile.importers.ingest.optionalDependencies?.[optionalPackage];
    expect(load(readFileSync(join(target, "pnpm-lock.yaml"), "utf8"))).toEqual(originalLockfile);
    expect(load(readFileSync(join(target, "pnpm-workspace.yaml"), "utf8"))).toEqual({
      packages: ["ingest", "shared", "db"],
      onlyBuiltDependencies: ["esbuild"],
      catalogs: { tooling: { typescript: "^5" } },
    });
    for (const manifest of ["package.json", "shared/package.json", "db/package.json"]) {
      expect(readJson(join(target, manifest))).toEqual(readJson(join(repository, manifest)));
    }
    expect(readFileSync(join(target, "patches", "source.patch"))).toEqual(Buffer.from(patchBytes));
    expect(readdirSync(join(target, "ingest"))).toEqual(["package.json"]);
    expect(existsSync(join(repository, "ingest", "node_modules"))).toBe(false);
    expect(existsSync(join(repository, "shared", "dist"))).toBe(false);
    expect(sourceFiles.map((path) => readFileSync(join(repository, path)))).toEqual(originals);
  });

  it("keeps every provider dependency when the retention policy is absent", () => {
    rmSync(join(repository, "ingest", "source-package-policy.json"));

    const result = prepareWorkspace();

    expect(result.status, result.stderr).toBe(0);
    expect(readJson(join(target, "ingest", "package.json"))).toEqual(
      readJson(join(repository, "ingest", "package.json")),
    );
    expect(existsSync(join(target, "ingest", "source-package-policy.json"))).toBe(false);
  });

  it("accepts an empty retention list and a repository without patch files", () => {
    writeRepositoryJson("ingest/source-package-policy.json", { retainedUnselectedPackages: [] });
    const patchesDirectory = resolve(repository, "patches");
    if (!patchesDirectory.startsWith(`${resolve(directory)}${sep}`)) {
      throw new Error("Refusing to remove patches outside the temporary fixture");
    }
    rmSync(patchesDirectory, { recursive: true });

    const result = prepareWorkspace();

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(target, "patches"))).toBe(false);
    expect(readJson(join(target, "ingest", "package.json"))).toEqual(
      readJson(join(repository, "ingest", "package.json")),
    );
  });

  it.each([
    null,
    {},
    { retainedUnselectedPackages: retainedPackage },
    { retainedUnselectedPackages: [12] },
    { retainedUnselectedPackages: [""] },
  ])("rejects a malformed retention policy before writing output: %j", (policy) => {
    writeRepositoryJson("ingest/source-package-policy.json", policy);

    expectFailure(/policy|retained|package/i);

    expect(existsSync(target)).toBe(false);
  });

  it.each([
    [retainedPackage, retainedPackage],
    ["@oboapp/source-sdk"],
    ["@oboapp/source-web-utils"],
    ["vitest"],
    ["@oboapp/source-missing"],
  ])("rejects invalid retained package names before writing output: %j", (...retainedUnselectedPackages) => {
    writeRepositoryJson("ingest/source-package-policy.json", { retainedUnselectedPackages });

    expectFailure(/retained|source|package|duplicate/i);

    expect(existsSync(target)).toBe(false);
  });

  it("rejects a provider declared only as a development dependency", () => {
    writeRepositoryJson("ingest/package.json", {
      name: "oboapp-ingest",
      devDependencies: { [retainedPackage]: "0.1.0" },
    });
    writeRepositoryJson("ingest/source-package-policy.json", { retainedUnselectedPackages: [retainedPackage] });

    expectFailure(/production|dependencies|declared/i);

    expect(existsSync(target)).toBe(false);
  });

  it("rejects an importer specifier mismatch before writing output", () => {
    const lockfile = load(readFileSync(join(repository, "pnpm-lock.yaml"), "utf8")) as FixtureLockfile;
    const dependencies = lockfile.importers.ingest.dependencies ?? {};
    dependencies[retainedPackage].specifier = "^0.1.0";
    writeRepositoryFile("pnpm-lock.yaml", dump(lockfile));

    expectFailure(/mismatch|match|specifier/i);

    expect(existsSync(target)).toBe(false);
  });

  it("removes shadowed declarations when pnpm records only the effective optional dependency", () => {
    const manifest = readJson(join(repository, "ingest", "package.json")) as {
      optionalDependencies: Record<string, string>;
    };
    manifest.optionalDependencies[retainedPackage] = "0.3.0";
    writeRepositoryJson("ingest/package.json", manifest);
    const lockfile = load(readFileSync(join(repository, "pnpm-lock.yaml"), "utf8")) as FixtureLockfile;
    delete lockfile.importers.ingest.dependencies?.[retainedPackage];
    delete lockfile.importers.ingest.devDependencies?.[retainedPackage];
    lockfile.importers.ingest.optionalDependencies = {
      ...lockfile.importers.ingest.optionalDependencies,
      [retainedPackage]: { specifier: "0.3.0", version: "0.3.0" },
    };
    writeRepositoryFile("pnpm-lock.yaml", dump(lockfile));

    const result = prepareWorkspace();

    expect(result.status, result.stderr).toBe(0);
    const projected = readJson(join(target, "ingest", "package.json")) as Record<string, Record<string, string>>;
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      expect(projected[group]).not.toHaveProperty(retainedPackage);
    }
  });

  it.each(["lockfile-version", "workspace-packages", "missing-importer"])(
    "rejects invalid installation inputs before writing output: %s",
    (invalidInput) => {
      if (invalidInput === "workspace-packages") {
        writeRepositoryFile("pnpm-workspace.yaml", dump({ packages: "ingest" }));
      } else {
        const lockfile = load(readFileSync(join(repository, "pnpm-lock.yaml"), "utf8")) as FixtureLockfile & {
          lockfileVersion: string;
        };
        if (invalidInput === "lockfile-version") {
          lockfile.lockfileVersion = "8.0";
        } else {
          delete lockfile.importers.shared;
        }
        writeRepositoryFile("pnpm-lock.yaml", dump(lockfile));
      }

      expectFailure(/lockfile|workspace|importer/i);

      expect(existsSync(target)).toBe(false);
    },
  );

  it.each(["existing-empty", "tmp/nested-output", "build-workspace"])(
    "accepts a safe empty target at %s",
    (relativeTarget) => {
      const outputDirectory = relativeTarget === "existing-empty"
        ? join(directory, relativeTarget)
        : join(repository, relativeTarget);
      mkdirSync(outputDirectory, { recursive: true });

      const result = prepareWorkspace(outputDirectory);

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(join(outputDirectory, "ingest", "package.json"))).toBe(true);
    },
  );

  it("refuses an occupied output without changing its marker", () => {
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "Existing build inputs");

    expectFailure(/new or empty/);

    expect(readdirSync(target)).toEqual(["keep.txt"]);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("Existing build inputs");
  });

  it.each([".", "..", "ingest", "shared", "tmp", "other-output"])(
    "refuses an unsafe repository target at %s",
    (relativeTarget) => {
      const before = readFileSync(join(repository, "package.json"));

      expectFailure(/repository|target|directory/i, resolve(repository, relativeTarget));

      expect(readFileSync(join(repository, "package.json"))).toEqual(before);
    },
  );

  it("resolves a redirected temporary directory before protecting source paths", () => {
    const temporaryDirectory = join(repository, "tmp");
    mkdirSync(temporaryDirectory);
    symlinkSync(join(repository, "shared"), join(temporaryDirectory, "redirected"), "junction");
    const originalManifest = readFileSync(join(repository, "shared", "package.json"));

    expectFailure(/repository|target|directory/i, join(temporaryDirectory, "redirected", "output"));

    expect(existsSync(join(repository, "shared", "output"))).toBe(false);
    expect(readFileSync(join(repository, "shared", "package.json"))).toEqual(originalManifest);
  });

  it.runIf(process.platform === "win32")("rejects an unavailable drive root without looping", () => {
    const drive = ["Z", "Y", "X", "W"].find((letter) => {
      return !existsSync(`${letter}:\\`);
    });
    if (!drive) {
      throw new Error("The target safety fixture requires an unavailable drive");
    }

    const result = spawnSync(process.execPath, [bootstrapScript, repository, `${drive}:\\obo-build-workspace`], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/resolve|target|directory|ENOENT/i);

    expect(existsSync(target)).toBe(false);
  });

  it("runs the standalone CLI without installed providers or shared output", () => {
    const result = spawnSync(process.execPath, [bootstrapScript, repository, target], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(target);
    expect(existsSync(join(target, "ingest", "package.json"))).toBe(true);
    expect(existsSync(join(repository, "ingest", "node_modules"))).toBe(false);
    expect(existsSync(join(repository, "shared", "dist"))).toBe(false);
  });

  it("reports usage when the target argument is missing", () => {
    const result = spawnSync(process.execPath, [bootstrapScript, repository], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/usage/i);
    expect(existsSync(target)).toBe(false);
  });
});
