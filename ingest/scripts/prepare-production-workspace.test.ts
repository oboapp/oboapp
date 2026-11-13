// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProductionWorkspace } from "./prepare-production-workspace";

const { metadata } = vi.hoisted(() => ({
  metadata: {
    id: "plovdiv-news",
    name: "Plovdiv news",
    url: "https://example.com/plovdiv",
    localities: ["bg.plovdiv"],
  },
}));
vi.mock("@oboapp/shared", () => ({ SOURCES: [metadata] }));

const selectedPackage = "@oboapp/source-plovdiv-news";
const unselectedPackage = "@oboapp/source-sofia-news";
const patchBytes = Uint8Array.from([0, 13, 10, 65, 255]);
const developerFiles = [
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

function writeRepositoryFile(path: string, contents: string | Uint8Array): void {
  const destination = join(repository, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function writeRepositoryJson(path: string, value: unknown): void {
  writeRepositoryFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "obo-production-workspace-"));
  repository = join(directory, "repo");
  target = join(directory, "output");
  writeRepositoryJson("package.json", {
    name: "plovdiv-instance",
    private: true,
    packageManager: "pnpm@10.11.0",
    pnpm: { patchedDependencies: { [`${selectedPackage}@1.2.3`]: "patches/source.patch" } },
  });
  const dependencies = {
    [selectedPackage]: "1.2.3",
    [unselectedPackage]: "0.1.0",
    "@oboapp/db": "workspace:*",
    "@oboapp/shared": "workspace:*",
  };
  writeRepositoryJson("ingest/package.json", { name: "oboapp-ingest", dependencies });
  writeRepositoryJson("shared/package.json", { name: "@oboapp/shared" });
  writeRepositoryJson("db/package.json", { name: "@oboapp/db" });
  writeRepositoryFile("pnpm-workspace.yaml", dump({ packages: ["api", "web", "ingest", "shared", "db"] }));
  writeRepositoryFile("pnpm-lock.yaml", dump({
    lockfileVersion: "9.0",
    settings: { autoInstallPeers: true },
    patchedDependencies: {
      [`${selectedPackage}@1.2.3`]: { hash: "exact-patch-hash", path: "patches/source.patch" },
    },
    importers: {
      ".": {},
      ingest: {
        dependencies: {
          [selectedPackage]: { specifier: "1.2.3", version: "1.2.3(patch_hash=exact-patch-hash)" },
          [unselectedPackage]: { specifier: "0.1.0", version: "0.1.0" },
          "@oboapp/db": { specifier: "workspace:*", version: "link:../db" },
          "@oboapp/shared": { specifier: "workspace:*", version: "link:../shared" },
        },
      },
      shared: {},
      db: {},
    },
    packages: { [`${selectedPackage}@1.2.3`]: { resolution: { integrity: "sha512-exact==" } } },
  }));
  writeRepositoryFile("patches/source.patch", patchBytes);
  writeRepositoryJson("ingest/source-package-policy.json", { retainedUnselectedPackages: [unselectedPackage] });
  writeRepositoryJson("ingest/terraform/source-jobs.bg.plovdiv.json", {
    news: { source: metadata.id, memory: "512Mi", timeout: "1800s" },
  });
  writeRepositoryFile(`ingest/crawlers/${metadata.id}/index.ts`, "throw new Error('Selected entrypoint was loaded');");
  for (const [name, packageMetadata] of [
    [selectedPackage, metadata],
    [unselectedPackage, { ...metadata, id: "sofia-news", localities: ["bg.sofia"] }],
  ] as const) {
    const packageRoot = `ingest/node_modules/${name}`;
    writeRepositoryJson(`${packageRoot}/package.json`, {
      name,
      exports: { ".": "./runtime.cjs", "./metadata": "./metadata.cjs" },
    });
    writeRepositoryFile(`${packageRoot}/metadata.cjs`, `exports.metadata = ${JSON.stringify(packageMetadata)};`);
    writeRepositoryFile(`${packageRoot}/runtime.cjs`, "throw new Error('Provider runtime was loaded');");
  }
});

afterEach(() => {
  const fixturePath = resolve(directory);
  if (!fixturePath.startsWith(`${resolve(tmpdir())}${sep}`)) {
    throw new Error("Refusing to remove a fixture outside the temporary directory");
  }
  rmSync(fixturePath, { recursive: true, force: true });
});

describe("production workspace writer", () => {
  it("writes only production manifests, YAML and exact patch bytes while preserving developer files", () => {
    const before = developerFiles.map((path) => readFileSync(join(repository, path)));

    prepareProductionWorkspace(repository, target);

    expect(readdirSync(target).sort()).toEqual([
      "db", "ingest", "package.json", "patches", "pnpm-lock.yaml", "pnpm-workspace.yaml", "shared",
    ]);
    expect(readdirSync(join(target, "ingest"))).toEqual(["package.json"]);
    expect(JSON.parse(readFileSync(join(target, "ingest", "package.json"), "utf8"))).toEqual({
      name: "oboapp-ingest",
      dependencies: {
        [selectedPackage]: "1.2.3",
        "@oboapp/db": "workspace:*",
        "@oboapp/shared": "workspace:*",
      },
    });
    expect(load(readFileSync(join(target, "pnpm-workspace.yaml"), "utf8"))).toEqual({
      packages: ["ingest", "shared", "db"],
    });
    expect(load(readFileSync(join(target, "pnpm-lock.yaml"), "utf8"))).toMatchObject({
      importers: {
        ingest: {
          dependencies: {
            [selectedPackage]: { specifier: "1.2.3", version: "1.2.3(patch_hash=exact-patch-hash)" },
          },
        },
      },
      packages: { [`${selectedPackage}@1.2.3`]: { resolution: { integrity: "sha512-exact==" } } },
    });
    expect(readFileSync(join(target, "patches", "source.patch"))).toEqual(Buffer.from(patchBytes));
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(existsSync(join(target, "ingest", "source-package-policy.json"))).toBe(false);
    expect(developerFiles.map((path) => readFileSync(join(repository, path)))).toEqual(before);
  });

  it("accepts an existing empty target", () => {
    mkdirSync(target);

    prepareProductionWorkspace(repository, target);

    expect(existsSync(join(target, "ingest", "package.json"))).toBe(true);
  });

  it("accepts the dedicated Docker output directory inside the repository", () => {
    const dockerTarget = join(repository, "production-workspace");

    prepareProductionWorkspace(repository, dockerTarget);

    expect(existsSync(join(dockerTarget, "ingest", "package.json"))).toBe(true);
  });

  it("validates the selected catalog and deployment jobs before creating the target", () => {
    writeRepositoryJson("ingest/terraform/source-jobs.bg.plovdiv.json", {});

    expect(() => prepareProductionWorkspace(repository, target)).toThrow(/no deployment job/);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses an occupied target and preserves its marker", () => {
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "Existing workspace");

    expect(() => prepareProductionWorkspace(repository, target)).toThrow(/new or empty directory/);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("Existing workspace");
    expect(readdirSync(target)).toEqual(["keep.txt"]);
  });

  it.each([".", "ingest", "shared", ".."])(
    "refuses the source directory target %s without changing source files",
    (relativeTarget) => {
      const before = readFileSync(join(repository, "package.json"));

      expect(() => prepareProductionWorkspace(repository, resolve(repository, relativeTarget))).toThrow(
        /source repository|inside the repository/,
      );
      expect(readFileSync(join(repository, "package.json"))).toEqual(before);
    },
  );
});
