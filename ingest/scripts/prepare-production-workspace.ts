import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { dump, load } from "js-yaml";
import { readInstalledSourcePackages } from "@/sources/installed-packages";
import { projectProductionWorkspace } from "@/sources/production-workspace";
import { getSelectedSourceIds } from "@/sources/registry";
import { resolveEmptyWorkspaceTarget } from "@/sources/workspace-target";
import { checkSourceConfiguration } from "./check-source-config";

function readManifest(fileName: string): unknown {
  return JSON.parse(readFileSync(fileName, "utf8"));
}

/** Write an installation workspace while preserving the developer manifests and lockfile. */
export function prepareProductionWorkspace(repoDirectory: string, targetDirectory: string): void {
  const repository = realpathSync(resolve(repoDirectory));
  const target = resolveEmptyWorkspaceTarget(repository, targetDirectory);

  const ingestDirectory = join(repository, "ingest");
  const runtimeDirectory = extname(__filename) === ".ts"
    ? ingestDirectory
    : join(ingestDirectory, "dist");
  checkSourceConfiguration(ingestDirectory, runtimeDirectory);
  const projected = projectProductionWorkspace({
    manifests: {
      ".": readManifest(join(repository, "package.json")),
      ingest: readManifest(join(ingestDirectory, "package.json")),
      shared: readManifest(join(repository, "shared", "package.json")),
      db: readManifest(join(repository, "db", "package.json")),
    },
    lockfile: load(readFileSync(join(repository, "pnpm-lock.yaml"), "utf8")),
    workspace: load(readFileSync(join(repository, "pnpm-workspace.yaml"), "utf8")),
    packages: readInstalledSourcePackages(ingestDirectory),
    selectedIds: getSelectedSourceIds(),
  });

  mkdirSync(target, { recursive: true });
  for (const [packageDirectory, manifest] of Object.entries(projected.manifests)) {
    const destination = join(target, packageDirectory, "package.json");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(join(target, "pnpm-lock.yaml"), dump(projected.lockfile, { noRefs: true, lineWidth: -1 }));
  writeFileSync(join(target, "pnpm-workspace.yaml"), dump(projected.workspace, { noRefs: true, lineWidth: -1 }));

  const patchesDirectory = join(repository, "patches");
  if (existsSync(patchesDirectory)) {
    cpSync(patchesDirectory, join(target, "patches"), { recursive: true });
  }
}

if (require.main === module) {
  try {
    const [targetDirectory, ...extraArguments] = process.argv.slice(2);
    if (!targetDirectory || extraArguments.length > 0) {
      throw new Error("Usage: prepare-production-workspace <target-directory>");
    }
    const repository = resolve(__dirname, extname(__filename) === ".ts" ? "../.." : "../../..");
    prepareProductionWorkspace(repository, targetDirectory);
    console.log(`Prepared production workspace at ${resolve(targetDirectory)}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
