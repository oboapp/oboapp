import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { resolveDockerExecutable } from "@/sources/docker-executable";
import { createSourceImageContentsVerifier } from "@/sources/source-image-verifier";
import { readInstalledPackageManifest, readInstalledSourcePackages } from "@/sources/installed-packages";

function createImageVerifier(unselectedPackages: readonly string[]): string {
  return `
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { userInfo } = require("node:os");

async function verify() {
  const user = userInfo();
  assert.equal(user.username, "node", "The image must run as node");
  assert.ok(user.uid > 0, "The image must use a non-root UID");
  assert.equal(process.cwd(), "/app/ingest", "The image must start in the ingest package");

${createSourceImageContentsVerifier("production", unselectedPackages)}
  await require("./dist/scripts/check-source-browsers.js").checkSourceBrowsers();
  verifySourceModuleIsolation();

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
export function checkSourceImage(imageTag: string, explicitDockerExecutable?: string): void {
  if (!imageTag || imageTag.startsWith("-")) {
    throw new Error("A local source image tag is required");
  }
  const dockerExecutable = resolveDockerExecutable(explicitDockerExecutable);
  const configuredUser = execFileSync(dockerExecutable, ["image", "inspect", "--format", "{{.Config.User}}", imageTag], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 60_000,
  }).trim();
  assert.equal(configuredUser, "node", "The Docker image must declare USER node");

  const runArguments = [
    "run", "--rm", "--pull", "never", "--network", "none", "--env", "COREPACK_ENABLE_NETWORK=0",
  ];
  execFileSync(dockerExecutable, [...runArguments, imageTag], { stdio: "inherit", timeout: 60_000 });
  const pnpmVersion = execFileSync(dockerExecutable, [...runArguments, imageTag, "pnpm", "--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 60_000,
  }).trim();
  assert.equal(pnpmVersion, "10.11.0", "The production user must have the pinned pnpm version available offline");

  const ingestDirectory = readInstalledPackageManifest("oboapp-ingest", __filename).directory;
  const selectedPackageNames = new Set([
    "@oboapp/source-sofiyska-voda",
    "@oboapp/source-triaditsa-org",
  ]);
  const unselectedPackages = readInstalledSourcePackages(ingestDirectory)
    .filter((source) => !selectedPackageNames.has(source.name))
    .map((source) => source.name);
  unselectedPackages.push("@oboapp/source-web-utils");
  execFileSync(dockerExecutable, [
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
    const [imageTag, dockerExecutable, ...extraArguments] = process.argv.slice(2);
    if (!imageTag || extraArguments.length > 0) {
      throw new Error("Usage: check-source-image <local-image-tag> [absolute-docker-executable]");
    }
    checkSourceImage(imageTag, dockerExecutable);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
