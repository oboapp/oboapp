// @vitest-environment node

import { strict as assert } from "node:assert";
import { dirname, posix } from "node:path";
import { compileFunction } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceImageContentsVerifier } from "@/sources/source-image-verifier";
import { checkSourceBuilderImage } from "./check-source-builder-image";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  resolveDockerExecutable: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("@/sources/docker-executable", () => ({
  resolveDockerExecutable: mocks.resolveDockerExecutable,
}));

const imageTag = "oboapp-source-builder:test";
const sourceVersions = {
  "@oboapp/source-sdk": "0.1.1",
  "@oboapp/source-triaditsa-org": "0.2.0",
};
const sourceIds = ["shared", "sofiyska-voda", "triaditsa-org"];
let files: Map<string, string>;
let directories: Map<string, string[]>;
let loadedModules: Record<string, unknown>;
let entrypoint: unknown;
let selectedIds: string[];
let resolvedPackages: Map<string, string>;

function addInstalledPackage(name: string, version: string): void {
  const storeEntry = `${name.replace("/", "+")}@${version}`;
  directories.get("/app/node_modules/.pnpm")?.push(storeEntry);
  const packageDirectory = `/app/node_modules/.pnpm/${storeEntry}/node_modules/${name}`;
  files.set(`${packageDirectory}/package.json`, JSON.stringify({ name, version }));
  resolvedPackages.set(name, `${packageDirectory}/index.js`);
}

function runContentsVerifier(stage: "builder" | "production" = "builder"): () => void {
  let script: string;
  if (stage === "builder") {
    checkSourceBuilderImage(imageTag);
    script = mocks.execFileSync.mock.calls[0][2].input;
  } else {
    script = createSourceImageContentsVerifier("production");
  }
  const imageRequire = Object.assign((name: string): unknown => {
    if (name === "node:assert/strict") {
      return assert;
    }
    if (name === "node:path") {
      return { dirname, join: posix.join };
    }
    if (name === "node:fs") {
      return {
        existsSync: (path: string) => files.has(path),
        readFileSync: (path: string) => {
          const value = files.get(path);
          if (value === undefined) {
            throw new Error(`Missing fixture file: ${path}`);
          }
          return value;
        },
        readdirSync: (path: string) => {
          const entries = directories.get(path);
          if (!entries) {
            throw new Error(`Missing fixture directory: ${path}`);
          }
          return entries.map((name) => ({
            name,
            isDirectory: () => true,
          }));
        },
      };
    }
    if (name === "/app/ingest/dist/sources/registry.js") {
      return {
        getSelectedSourceIds: () => [...selectedIds],
        getEmergentSourceIds: () => ["sofiyska-voda"],
      };
    }
    if (name.endsWith("/index.js")) {
      return entrypoint;
    }
    throw new Error(`Unexpected verifier import: ${name}`);
  }, {
    resolve: (name: string) => {
      const resolved = resolvedPackages.get(name);
      if (!resolved) {
        throw new Error(`Uninstalled fixture package: ${name}`);
      }
      return resolved;
    },
    cache: loadedModules,
  });
  const verify = compileFunction(`${script}\nreturn verifySourceModuleIsolation;`, ["require", "console"]);
  return verify(imageRequire, { log: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveDockerExecutable.mockReturnValue("/usr/bin/docker");
  files = new Map([
    ["/app/ingest/package.json", JSON.stringify({ dependencies: sourceVersions })],
  ]);
  directories = new Map([
    ["/app/node_modules/.pnpm", []],
    ["/app/ingest/crawlers", [...sourceIds]],
    ["/app/ingest/dist/crawlers", [...sourceIds]],
  ]);
  resolvedPackages = new Map();
  loadedModules = {};
  selectedIds = ["triaditsa-org", "sofiyska-voda"];
  entrypoint = {
    crawl: vi.fn(() => {
      throw new Error("The image verifier must not run collection");
    }),
  };
  for (const [name, version] of Object.entries(sourceVersions)) {
    addInstalledPackage(name, version);
  }
  vi.spyOn(console, "log").mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("source builder image verification", () => {
  it.each(["", "--privileged", "-v"])("rejects unsafe image tag %j before resolving Docker", (tag) => {
    expect(() => checkSourceBuilderImage(tag)).toThrow(/local source builder image tag/);
    expect(mocks.resolveDockerExecutable).not.toHaveBeenCalled();
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it("uses the shared Docker resolver and runs a read-only offline container without overriding its user", () => {
    checkSourceBuilderImage(imageTag, "/custom/docker");

    expect(mocks.resolveDockerExecutable).toHaveBeenCalledWith("/custom/docker");
    expect(mocks.execFileSync).toHaveBeenCalledWith("/usr/bin/docker", [
      "run", "--rm", "--pull", "never", "--network", "none", "--read-only",
      "--env", "COREPACK_ENABLE_NETWORK=0", "--workdir", "/app/ingest", "-i",
      "--entrypoint", "node", imageTag,
    ], {
      input: expect.any(String),
      stdio: ["pipe", "inherit", "inherit"],
      timeout: 60_000,
    });
  });

  it("propagates resolver and Docker failures without reporting success", () => {
    const failure = new Error("Docker is unavailable");
    mocks.resolveDockerExecutable.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => checkSourceBuilderImage(imageTag)).toThrow(failure);
    expect(mocks.execFileSync).not.toHaveBeenCalled();

    mocks.execFileSync.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => checkSourceBuilderImage(imageTag)).toThrow(failure);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("accepts only selected package contents and loads entrypoints without running collection", () => {
    expect(() => runContentsVerifier()).not.toThrow();
    expect((entrypoint as { crawl: ReturnType<typeof vi.fn> }).crawl).not.toHaveBeenCalled();
  });

  it("shares contents checks with production images where raw implementations are absent", () => {
    directories.delete("/app/ingest/crawlers");

    expect(() => runContentsVerifier("production")).not.toThrow();
  });

  it("rejects raw implementations present in a production image", () => {
    files.set("/app/ingest/crawlers", "Raw source directory");

    expect(() => runContentsVerifier("production")).toThrow(/Raw crawler implementations/);
  });

  it("detects a browser runtime loaded after the initial module-isolation check", () => {
    const verifyModuleIsolation = runContentsVerifier();
    loadedModules["/app/node_modules/playwright-core/index.js"] = {};

    expect(() => verifyModuleIsolation()).toThrow(/avoid database initialization and browser runtimes/);
  });

  it.each(["dependencies", "devDependencies", "optionalDependencies"])(
    "rejects an unselected package retained in %s",
    (group) => {
      files.set("/app/ingest/package.json", JSON.stringify({
        dependencies: sourceVersions,
        [group]: { ...sourceVersions, "@oboapp/source-mladost-bg": "0.1.1" },
      }));

      expect(() => runContentsVerifier()).toThrow(/image manifest/);
    },
  );

  it("rejects an unselected package physically present in the pnpm store", () => {
    addInstalledPackage("@oboapp/source-mladost-bg", "0.1.1");

    expect(() => runContentsVerifier()).toThrow(/pnpm store/);
  });

  it("rejects an installed selected package whose version differs from the manifest", () => {
    const resolved = resolvedPackages.get("@oboapp/source-triaditsa-org");
    assert.ok(resolved);
    files.set(`${dirname(resolved)}/package.json`, JSON.stringify({
      name: "@oboapp/source-triaditsa-org",
      version: "0.1.0",
    }));

    expect(() => runContentsVerifier()).toThrow(/Direct source versions/);
  });

  it("rejects the retained development package policy", () => {
    files.set("/app/ingest/source-package-policy.json", "{}");

    expect(() => runContentsVerifier()).toThrow(/development source-package policy/);
  });

  it.each(["crawlers", "dist/crawlers"])("rejects an unselected implementation in %s", (directory) => {
    directories.get(`/app/ingest/${directory}`)?.push("mladost-bg");

    expect(() => runContentsVerifier()).toThrow(/Image source directories/);
  });

  it("rejects a runtime registry that differs from the fixture catalog", () => {
    selectedIds.push("mladost-bg");

    expect(() => runContentsVerifier()).toThrow(/deep-equal/);
  });

  it("rejects a selected entrypoint without a callable crawl export", () => {
    entrypoint = {};

    expect(() => runContentsVerifier()).toThrow(/function/);
  });

  it.each([
    "/app/ingest/dist/lib/db.js",
    "/app/ingest/dist/lib/firebase-admin.js",
    "/app/node_modules/firebase-admin/lib/index.js",
    "/app/node_modules/playwright/index.js",
    "/app/node_modules/playwright-core/index.js",
  ])("rejects forbidden runtime initialization through %s", (fileName) => {
    loadedModules[fileName] = {};

    expect(() => runContentsVerifier()).toThrow(/avoid database initialization and browser runtimes/);
  });
});
