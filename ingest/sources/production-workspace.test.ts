// @vitest-environment node

import { describe, expect, it } from "vitest";
import { projectProductionWorkspace } from "./production-workspace";
import type { InstalledSourcePackage } from "./selection";

const selectedPackage = "@oboapp/source-plovdiv-news";
const unselectedPackage = "@oboapp/source-sofia-news";
const optionalPackage = "@oboapp/source-sofia-optional";

function sourcePackage(name: string, id: string, version: string): InstalledSourcePackage {
  return {
    name,
    version,
    metadata: {
      id,
      name: id,
      url: `https://example.com/${id}`,
      localities: [id.startsWith("plovdiv") ? "bg.plovdiv" : "bg.sofia"],
    },
  };
}

function fixture() {
  return {
    manifests: {
      ".": {
        name: "instance",
        packageManager: "pnpm@10.11.0",
        scripts: { prepare: "husky", build: "pnpm build:shared" },
        devDependencies: { typescript: "^5" },
        pnpm: {
          onlyBuiltDependencies: ["esbuild"],
          overrides: { "basic-ftp": "^5.2.1" },
          patchedDependencies: {
            [`${unselectedPackage}@0.1.0`]: "patches/source-sofia-news.patch",
          },
        },
      },
      ingest: {
        name: "oboapp-ingest",
        private: true,
        scripts: { build: "tsx scripts/build-selected-sources.ts" },
        dependencies: {
          [selectedPackage]: "1.2.3",
          [unselectedPackage]: "0.1.0",
          "@oboapp/source-sdk": "0.1.1",
          "@oboapp/db": "workspace:*",
          "@oboapp/shared": "workspace:*",
        },
        devDependencies: { [unselectedPackage]: "0.1.0", typescript: "^5" },
        optionalDependencies: { [optionalPackage]: "0.2.0" },
        engines: { node: ">=22" },
      },
      shared: {
        name: "@oboapp/shared",
        dependencies: { zod: "^4.3.6" },
        exports: { ".": "./dist/index.js" },
      },
      db: {
        name: "@oboapp/db",
        dependencies: { "@oboapp/shared": "workspace:*" },
      },
    },
    lockfile: {
      lockfileVersion: "9.0",
      settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
      overrides: { "basic-ftp": "^5.2.1" },
      patchedDependencies: {
        [`${unselectedPackage}@0.1.0`]: { hash: "unchanged-patch-hash", path: "patches/source-sofia-news.patch" },
      },
      importers: {
        ".": { devDependencies: { typescript: { specifier: "^5", version: "5.9.3" } } },
        ingest: {
          dependencies: {
            [selectedPackage]: { specifier: "1.2.3", version: "1.2.3(playwright@1.61.1)" },
            [unselectedPackage]: { specifier: "0.1.0", version: "0.1.0(patch_hash=unchanged-patch-hash)" },
            "@oboapp/source-sdk": { specifier: "0.1.1", version: "0.1.1" },
            "@oboapp/db": { specifier: "workspace:*", version: "link:../db" },
            "@oboapp/shared": { specifier: "workspace:*", version: "link:../shared" },
          },
          devDependencies: {
            [unselectedPackage]: { specifier: "0.1.0", version: "0.1.0(patch_hash=unchanged-patch-hash)" },
            typescript: { specifier: "^5", version: "5.9.3" },
          },
          optionalDependencies: { [optionalPackage]: { specifier: "0.2.0", version: "0.2.0" } },
        },
        shared: { dependencies: { zod: { specifier: "^4.3.6", version: "4.3.6" } } },
        db: { dependencies: { "@oboapp/shared": { specifier: "workspace:*", version: "link:../shared" } } },
        api: { dependencies: { hono: { specifier: "^4", version: "4.13.0" } } },
        web: { dependencies: { next: { specifier: "^16", version: "16.4.6(react@19.3.1)" } } },
      },
      packages: {
        [`${selectedPackage}@1.2.3`]: {
          resolution: { integrity: "sha512-selected-exact-integrity==" },
          peerDependencies: { playwright: ">=1.60" },
        },
        [`${unselectedPackage}@0.1.0`]: { resolution: { integrity: "sha512-unselected-retained-in-lock==" } },
      },
      snapshots: {
        [`${selectedPackage}@1.2.3(playwright@1.61.1)`]: { dependencies: { playwright: "1.61.1" } },
        [`${unselectedPackage}@0.1.0(patch_hash=unchanged-patch-hash)`]: { dependencies: { "source-helper": "0.3.1" } },
      },
    },
    workspace: {
      packages: ["api", "web", "ingest", "shared", "db"],
      onlyBuiltDependencies: ["esbuild"],
      catalog: { typescript: "5.9.3" },
    },
    packages: [
      sourcePackage(selectedPackage, "plovdiv-news", "1.2.3"),
      sourcePackage(unselectedPackage, "sofia-news", "0.1.0"),
      sourcePackage(optionalPackage, "sofia-optional", "0.2.0"),
    ],
    selectedIds: ["plovdiv-news"],
  };
}

describe("selected source production workspace", () => {
  it("keeps selected provider dependencies and removes unselected providers from manifests and importer sections", () => {
    const input = fixture();
    const result = projectProductionWorkspace(input);

    expect(result.manifests.ingest).toEqual({
      ...input.manifests.ingest,
      dependencies: {
        [selectedPackage]: "1.2.3",
        "@oboapp/source-sdk": "0.1.1",
        "@oboapp/db": "workspace:*",
        "@oboapp/shared": "workspace:*",
      },
      devDependencies: { typescript: "^5" },
      optionalDependencies: {},
    });
    expect(result.lockfile).toEqual({
      ...input.lockfile,
      importers: {
        ".": input.lockfile.importers["."],
        ingest: {
          dependencies: {
            [selectedPackage]: { specifier: "1.2.3", version: "1.2.3(playwright@1.61.1)" },
            "@oboapp/source-sdk": { specifier: "0.1.1", version: "0.1.1" },
            "@oboapp/db": { specifier: "workspace:*", version: "link:../db" },
            "@oboapp/shared": { specifier: "workspace:*", version: "link:../shared" },
          },
          devDependencies: { typescript: { specifier: "^5", version: "5.9.3" } },
          optionalDependencies: {},
        },
        shared: input.lockfile.importers.shared,
        db: input.lockfile.importers.db,
      },
    });
    expect(result.workspace).toEqual({ ...input.workspace, packages: ["ingest", "shared", "db"] });
  });

  it("preserves package resolutions, peers, patches, settings, workspace links and non-ingest manifests exactly", () => {
    const input = fixture();
    const result = projectProductionWorkspace(input);

    expect(result.manifests["."]).toEqual(input.manifests["."]);
    expect(result.manifests.shared).toEqual(input.manifests.shared);
    expect(result.manifests.db).toEqual(input.manifests.db);
    expect(result.lockfile).toMatchObject({
      lockfileVersion: input.lockfile.lockfileVersion,
      settings: input.lockfile.settings,
      overrides: input.lockfile.overrides,
      patchedDependencies: input.lockfile.patchedDependencies,
      packages: input.lockfile.packages,
      snapshots: input.lockfile.snapshots,
    });
    expect(result.lockfile).toHaveProperty(["importers", "."], input.lockfile.importers["."]);
    expect(result.lockfile).toHaveProperty(["importers", "shared"], input.lockfile.importers.shared);
    expect(result.lockfile).toHaveProperty(["importers", "db"], input.lockfile.importers.db);
  });

  it("keeps dependency and importer mappings unchanged when every installed provider is selected", () => {
    const input = fixture();
    input.selectedIds = ["plovdiv-news", "sofia-news", "sofia-optional"];

    const result = projectProductionWorkspace(input);

    expect(result.manifests).toEqual(input.manifests);
    expect(result.lockfile).toHaveProperty(["importers", "ingest"], input.lockfile.importers.ingest);
  });

  it.each([{ selectedIds: [] }, { selectedIds: ["legacy-water"] }])(
    "supports no selected packages with source IDs $selectedIds",
    ({ selectedIds }) => {
      const input = fixture();
      input.selectedIds = selectedIds;

      const result = projectProductionWorkspace(input);

      expect(result.manifests.ingest).toMatchObject({
        dependencies: {
          "@oboapp/source-sdk": "0.1.1",
          "@oboapp/db": "workspace:*",
          "@oboapp/shared": "workspace:*",
        },
        devDependencies: { typescript: "^5" },
        optionalDependencies: {},
      });
      expect(result.manifests.ingest).not.toHaveProperty(["dependencies", selectedPackage]);
      expect(result.lockfile).not.toHaveProperty(["importers", "ingest", "dependencies", selectedPackage]);
    },
  );

  it("leaves every developer input unchanged", () => {
    const input = fixture();
    const before = structuredClone(input);

    projectProductionWorkspace(input);

    expect(input).toEqual(before);
  });

  it("rejects a missing production importer", () => {
    const input = fixture();
    const { ingest: _ingest, ...remainingImporters } = input.lockfile.importers;

    expect(() => projectProductionWorkspace({
      ...input,
      lockfile: { ...input.lockfile, importers: remainingImporters },
    })).toThrow(/ingest/);
  });

  it("rejects a provider dependency missing from the matching lockfile importer", () => {
    const input = fixture();
    const { [selectedPackage]: _provider, ...dependencies } = input.lockfile.importers.ingest.dependencies;

    expect(() => projectProductionWorkspace({
      ...input,
      lockfile: {
        ...input.lockfile,
        importers: {
          ...input.lockfile.importers,
          ingest: { ...input.lockfile.importers.ingest, dependencies },
        },
      },
    })).toThrow(/plovdiv-news/);
  });

  it("rejects a lockfile specifier that differs from the provider manifest", () => {
    const input = fixture();
    input.lockfile.importers.ingest.dependencies[selectedPackage].specifier = "^1.2.3";

    expect(() => projectProductionWorkspace(input)).toThrow(/plovdiv-news/);
  });

  it("rejects a lock importer entry absent from the manifest", () => {
    const input = fixture();

    expect(() => projectProductionWorkspace({
      ...input,
      lockfile: {
        ...input.lockfile,
        importers: {
          ...input.lockfile.importers,
          ingest: {
            ...input.lockfile.importers.ingest,
            dependencies: {
              ...input.lockfile.importers.ingest.dependencies,
              "@oboapp/source-unlisted-sofia": { specifier: "0.1.0", version: "0.1.0" },
            },
          },
        },
      },
    })).toThrow(/unlisted-sofia/);
  });

  it("preserves pnpm's auto-installed optional Firebase peer in the database importer", () => {
    const input = fixture();
    const db = {
      ...input.manifests.db,
      peerDependencies: { "firebase-admin": "^13.0.0" },
      peerDependenciesMeta: { "firebase-admin": { optional: true } },
    };
    const dbImporter = {
      dependencies: {
        ...input.lockfile.importers.db.dependencies,
        "firebase-admin": { specifier: "^13.0.0", version: "13.6.1(encoding@0.1.13)" },
      },
    };

    const result = projectProductionWorkspace({
      ...input,
      manifests: { ...input.manifests, db },
      lockfile: {
        ...input.lockfile,
        importers: { ...input.lockfile.importers, db: dbImporter },
      },
    });

    expect(result.manifests.db).toEqual(db);
    expect(result.lockfile).toHaveProperty(["importers", "db"], dbImporter);
  });

  it.each(["missing", "mismatched"])("rejects %s provider package metadata", (problem) => {
    const input = fixture();
    if (problem === "missing") {
      input.packages = input.packages.filter((source) => source.name !== selectedPackage);
    } else {
      input.packages = input.packages.map((source) => {
        if (source.name === selectedPackage) {
          return { ...source, version: "1.2.4" };
        }
        return source;
      });
    }

    expect(() => projectProductionWorkspace(input)).toThrow(/plovdiv-news/);
  });
});
