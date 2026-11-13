/** Generate shared package, implementation and loading checks for the two-source fixture. */
export function createSourceImageContentsVerifier(
  stage: "builder" | "production",
  unselectedPackages: readonly string[] = [],
): string {
  return `
const contentsAssert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const isBuilder = ${stage === "builder"};
const ingestDirectory = "/app/ingest";

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

const registry = require(join(ingestDirectory, "dist/sources/registry.js"));
const selectedIds = registry.getSelectedSourceIds();
contentsAssert.deepEqual([...selectedIds].sort(), ["sofiyska-voda", "triaditsa-org"]);
contentsAssert.deepEqual(registry.getEmergentSourceIds(), ["sofiyska-voda"]);

const manifest = JSON.parse(readFileSync(join(ingestDirectory, "package.json"), "utf8"));
const dependencies = {
  ...(isBuilder ? manifest.devDependencies : {}),
  ...manifest.dependencies,
  ...manifest.optionalDependencies,
};
const expectedPackages = Object.keys(dependencies)
  .filter((name) => name.startsWith("@oboapp/source-"))
  .sort();
contentsAssert.deepEqual(expectedPackages, ["@oboapp/source-sdk", "@oboapp/source-triaditsa-org"],
  "The image manifest must select only the fixture packages");
if (isBuilder) {
  contentsAssert.equal(existsSync(join(ingestDirectory, "source-package-policy.json")), false,
    "The builder must not retain the development source-package policy");
}
for (const packageName of expectedPackages) {
  const directManifest = readNamedPackageManifest(packageName, require.resolve(packageName));
  contentsAssert.equal(directManifest.version, dependencies[packageName],
    "Direct source versions must match the projected manifest");
}

const storeDirectory = "/app/node_modules/.pnpm";
const installedPackages = new Set();
for (const entry of readdirSync(storeDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("@oboapp+source-")) {
    continue;
  }
  const packageName = entry.name.slice(0, entry.name.indexOf("@", 1)).replace("+", "/");
  const packageManifest = JSON.parse(readFileSync(
    join(storeDirectory, entry.name, "node_modules", packageName, "package.json"), "utf8"));
  contentsAssert.equal(packageManifest.name, packageName);
  installedPackages.add(packageName);
}
contentsAssert.deepEqual([...installedPackages].sort(), expectedPackages,
  "The pnpm store must contain only selected source packages and the SDK");
for (const packageName of ${JSON.stringify(unselectedPackages)}) {
  contentsAssert.throws(() => require.resolve(packageName), { code: "MODULE_NOT_FOUND" });
}

const sourceDirectories = isBuilder ? ["crawlers", "dist/crawlers"] : ["dist/crawlers"];
for (const directory of sourceDirectories) {
  const sourceIds = readdirSync(join(ingestDirectory, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  contentsAssert.deepEqual(sourceIds, ["shared", "sofiyska-voda", "triaditsa-org"],
    "Image source directories must match the fixture selection: " + directory);
}
if (!isBuilder) {
  contentsAssert.equal(existsSync(join(ingestDirectory, "crawlers")), false,
    "Raw crawler implementations must be absent");
}
for (const sourceId of selectedIds) {
  const entrypoint = require(join(ingestDirectory, "dist/crawlers", sourceId, "index.js"));
  contentsAssert.equal(typeof entrypoint.crawl, "function");
}
function verifySourceModuleIsolation() {
  const forbiddenModules = Object.keys(require.cache).filter((fileName) => {
    return fileName === "/app/ingest/dist/lib/db.js" ||
      fileName === "/app/ingest/dist/lib/firebase-admin.js" ||
      fileName.includes("/node_modules/firebase-admin/") ||
      fileName.includes("/node_modules/playwright/") ||
      fileName.includes("/node_modules/playwright-core/");
  });
  contentsAssert.deepEqual(forbiddenModules, [],
    "Loading selected entrypoints must avoid database initialization and browser runtimes");
}
verifySourceModuleIsolation();
`;
}
