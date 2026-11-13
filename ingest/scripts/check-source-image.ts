import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readInstalledPackageManifest, readInstalledSourcePackages } from "@/sources/installed-packages";

function createImageVerifier(unselectedPackages: readonly string[]): string {
  return String.raw`
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { userInfo } = require("node:os");
const { dirname, join } = require("node:path");

function readNamedPackageManifest(packageName, resolvedEntrypoint) {
  let directory = dirname(resolvedEntrypoint);
  while (true) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === packageName) {
        return manifest;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Cannot find the installed manifest for " + packageName);
    }
    directory = parent;
  }
}

async function verify() {
  const user = userInfo();
  assert.equal(user.username, "node", "The image must run as node");
  assert.ok(user.uid > 0, "The image must use a non-root UID");
  assert.equal(process.cwd(), "/app/ingest", "The image must start in the ingest package");

  const registry = require("./dist/sources/registry.js");
  const selectedIds = registry.getSelectedSourceIds();
  assert.deepEqual([...selectedIds].sort(), ["sofiyska-voda", "triaditsa-org"]);
  assert.deepEqual(registry.getEmergentSourceIds(), ["sofiyska-voda"]);

  const manifest = JSON.parse(readFileSync("./package.json", "utf8"));
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
  const expectedPackages = Object.keys(dependencies)
    .filter((name) => name.startsWith("@oboapp/source-"))
    .sort();
  assert.deepEqual(expectedPackages, ["@oboapp/source-sdk", "@oboapp/source-triaditsa-org"]);

  for (const packageName of expectedPackages) {
    const directManifest = readNamedPackageManifest(packageName, require.resolve(packageName));
    assert.equal(directManifest.version, dependencies[packageName], "Direct source versions must match the projected manifest");
  }

  const storeDirectory = "/app/node_modules/.pnpm";
  const installedPackages = new Set();
  for (const entry of readdirSync(storeDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("@oboapp+source-")) {
      continue;
    }
    const packageName = entry.name.slice(0, entry.name.indexOf("@", 1)).replace("+", "/");
    const packageManifest = JSON.parse(readFileSync(
      join(storeDirectory, entry.name, "node_modules", packageName, "package.json"),
      "utf8",
    ));
    assert.equal(packageManifest.name, packageName);
    installedPackages.add(packageName);
  }
  assert.deepEqual([...installedPackages].sort(), expectedPackages, "The pnpm store must contain only selected source packages and the SDK");

  for (const packageName of ${JSON.stringify(unselectedPackages)}) {
    assert.throws(() => require.resolve(packageName), { code: "MODULE_NOT_FOUND" });
  }

  const compiledSources = readdirSync("./dist/crawlers", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(compiledSources, ["shared", "sofiyska-voda", "triaditsa-org"]);
  assert.equal(existsSync("/app/ingest/crawlers"), false, "Raw crawler implementations must be absent");

  for (const sourceId of selectedIds) {
    const entrypoint = require("./dist/crawlers/" + sourceId + "/index.js");
    assert.equal(typeof entrypoint.crawl, "function");
  }
  await require("./dist/scripts/check-source-browsers.js").checkSourceBrowsers();

  const forbiddenModules = Object.keys(require.cache).filter((fileName) => {
    return fileName === "/app/ingest/dist/lib/db.js" ||
      fileName === "/app/ingest/dist/lib/firebase-admin.js" ||
      fileName.includes("/node_modules/firebase-admin/") ||
      fileName.includes("/node_modules/playwright/") ||
      fileName.includes("/node_modules/playwright-core/");
  });
  assert.deepEqual(forbiddenModules, [], "Loading selected entrypoints must avoid database initialization and browser runtimes");

  for (const command of ["crawl", "pipeline"]) {
    const help = execFileSync(process.execPath, ["./dist/" + command + ".js", "--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    for (const sourceId of selectedIds) {
      assert.ok(help.includes(sourceId), "CLI help must include selected source " + sourceId);
    }
    assert.equal(help.includes("sensor-community"), false);
  }
  const rejected = spawnSync(process.execPath, ["./dist/crawl.js", "--source", "sensor-community"], {
    encoding: "utf8",
  });
  if (rejected.error) {
    throw rejected.error;
  }
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.ok(rejected.stdout.includes("Source is not selected for this instance"), rejected.stdout);

  console.log("Selected source image runs as node without database initialization or browser loading");
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}

/** Verify the minimal two-source production image without provider or database access. */
export function checkSourceImage(imageTag: string): void {
  if (!imageTag || imageTag.startsWith("-")) {
    throw new Error("A local source image tag is required");
  }
  const configuredUser = execFileSync("docker", ["image", "inspect", "--format", "{{.Config.User}}", imageTag], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 60_000,
  }).trim();
  assert.equal(configuredUser, "node", "The Docker image must declare USER node");

  const runArguments = [
    "run", "--rm", "--pull", "never", "--network", "none", "--env", "COREPACK_ENABLE_NETWORK=0",
  ];
  execFileSync("docker", [...runArguments, imageTag], { stdio: "inherit", timeout: 60_000 });
  const pnpmVersion = execFileSync("docker", [...runArguments, imageTag, "pnpm", "--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 60_000,
  }).trim();
  assert.equal(pnpmVersion, "10.11.0", "The production user must have the pinned pnpm version available offline");

  const ingestDirectory = readInstalledPackageManifest("oboapp-ingest", __filename).directory;
  const unselectedPackages = readInstalledSourcePackages(ingestDirectory)
    .filter((source) => source.name !== "@oboapp/source-triaditsa-org")
    .map((source) => source.name);
  unselectedPackages.push("@oboapp/source-web-utils");
  execFileSync("docker", [
    ...runArguments, "-i", "--read-only", "--entrypoint", "node", imageTag,
  ], {
    input: createImageVerifier(unselectedPackages),
    stdio: ["pipe", "inherit", "inherit"],
    timeout: 60_000,
  });
  console.log(`Minimal source image checks passed for ${imageTag}`);
}

if (require.main === module) {
  try {
    const [imageTag, ...extraArguments] = process.argv.slice(2);
    if (!imageTag || extraArguments.length > 0) {
      throw new Error("Usage: check-source-image <local-image-tag>");
    }
    checkSourceImage(imageTag);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
