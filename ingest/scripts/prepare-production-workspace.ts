import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { dump, load } from "js-yaml";
import { readInstalledSourcePackages } from "@/sources/installed-packages";
import { projectProductionWorkspace } from "@/sources/production-workspace";
import { getSelectedSourceIds } from "@/sources/registry";
import { checkSourceConfiguration } from "./check-source-config";

function isWithin(directory: string, parentDirectory: string): boolean {
  const relativePath = relative(parentDirectory, directory);
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

/** Resolve existing ancestors so a junction cannot redirect output into source files. */
function resolveTarget(directory: string): string {
  let existingDirectory = resolve(directory);
  const missingSegments: string[] = [];
  while (!existsSync(existingDirectory)) {
    missingSegments.unshift(basename(existingDirectory));
    const parentDirectory = dirname(existingDirectory);
    if (parentDirectory === existingDirectory) {
      throw new Error(`Cannot resolve production workspace target: ${directory}`);
    }
    existingDirectory = parentDirectory;
  }
  return resolve(realpathSync(existingDirectory), ...missingSegments);
}

function validateTarget(repoDirectory: string, targetDirectory: string): void {
  if (isWithin(repoDirectory, targetDirectory)) {
    throw new Error("Production workspace target must not contain the source repository");
  }
  if (isWithin(targetDirectory, repoDirectory)) {
    const temporaryDirectory = join(repoDirectory, "tmp");
    const isTemporaryOutput = targetDirectory !== temporaryDirectory && isWithin(targetDirectory, temporaryDirectory);
    const isDockerOutput = targetDirectory === join(repoDirectory, "production-workspace");
    if (!isTemporaryOutput && !isDockerOutput) {
      throw new Error("Production workspace target inside the repository must be under tmp or named production-workspace");
    }
  }
  if (existsSync(targetDirectory)) {
    if (!statSync(targetDirectory).isDirectory() || readdirSync(targetDirectory).length > 0) {
      throw new Error("Production workspace target must be a new or empty directory");
    }
  }
}

function readManifest(fileName: string): unknown {
  return JSON.parse(readFileSync(fileName, "utf8"));
}

/** Write an installation workspace while preserving the developer manifests and lockfile. */
export function prepareProductionWorkspace(repoDirectory: string, targetDirectory: string): void {
  const repository = realpathSync(resolve(repoDirectory));
  const target = resolveTarget(targetDirectory);
  validateTarget(repository, target);

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
