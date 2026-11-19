import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";

const projects = [".", "ingest", "shared", "db"];
const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies"];
const supportPackages = new Set(["@oboapp/source-sdk", "@oboapp/source-web-utils"]);

function readJson(fileName) {
  return JSON.parse(readFileSync(fileName, "utf8"));
}

function contains(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function emptyTarget(repository, requestedTarget) {
  const segments = [];
  let ancestor = resolve(requestedTarget);
  while (!existsSync(ancestor)) {
    segments.unshift(basename(ancestor));
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new Error(`Cannot resolve build workspace target: ${requestedTarget}`);
    }
    ancestor = parent;
  }
  const target = resolve(realpathSync(ancestor), ...segments);
  if (contains(target, repository)) {
    throw new Error("Build workspace target must not contain the source repository");
  }
  const temporaryRoot = join(repository, "tmp");
  if (contains(repository, target) && target !== join(repository, "build-workspace") &&
      (target === temporaryRoot || !contains(temporaryRoot, target))) {
    throw new Error("Build workspace target inside the repository must be under tmp or named build-workspace");
  }
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) {
    throw new Error("Build workspace target must be a new or empty directory");
  }
  return target;
}

function readRetainedPackages(repository) {
  const policyPath = join(repository, "ingest", "source-package-policy.json");
  if (!existsSync(policyPath)) {
    return [];
  }
  const policy = readJson(policyPath);
  const names = policy?.retainedUnselectedPackages;
  if (!Array.isArray(names) || Object.keys(policy).length !== 1 || names.some((name) => {
    return typeof name !== "string" || !name.startsWith("@oboapp/source-") ||
      name === "@oboapp/source-" || supportPackages.has(name);
  }) || new Set(names).size !== names.length) {
    throw new Error("Invalid retainedUnselectedPackages: expected unique source implementation package names");
  }
  return names;
}

function projectInputs(repository) {
  const manifests = Object.fromEntries(projects.map((project) => {
    return [project, readJson(join(repository, project, "package.json"))];
  }));
  const lockfile = load(readFileSync(join(repository, "pnpm-lock.yaml"), "utf8"));
  const workspace = load(readFileSync(join(repository, "pnpm-workspace.yaml"), "utf8"));
  if (String(lockfile?.lockfileVersion) !== "9.0" && lockfile?.lockfileVersion !== 9) {
    throw new Error("Build workspace requires pnpm lockfile version 9.0");
  }
  if (!Array.isArray(workspace?.packages)) {
    throw new TypeError("Build workspace requires workspace packages");
  }
  const importers = Object.fromEntries(projects.map((project) => {
    const importer = lockfile.importers?.[project];
    if (!importer) {
      throw new Error(`Missing lockfile importer ${project}`);
    }
    return [project, importer];
  }));
  for (const name of readRetainedPackages(repository)) {
    const manifest = manifests.ingest;
    if (!Object.hasOwn(manifest.dependencies ?? {}, name) &&
        !Object.hasOwn(manifest.optionalDependencies ?? {}, name)) {
      throw new Error(`Retained source package ${name} is not a production dependency`);
    }
    const effectiveGroup = Object.hasOwn(manifest.optionalDependencies ?? {}, name)
      ? "optionalDependencies"
      : "dependencies";
    for (const group of dependencyGroups) {
      const specifier = manifest[group]?.[name];
      const locked = importers.ingest[group]?.[name];
      if ((group === effectiveGroup || locked !== undefined) && specifier !== locked?.specifier) {
        throw new Error(`Lockfile importer ingest does not match ${group}.${name}`);
      }
      delete manifest[group]?.[name];
      delete importers.ingest[group]?.[name];
    }
  }
  lockfile.importers = importers;
  workspace.packages = projects.filter((project) => project !== ".");
  return { manifests, lockfile, workspace };
}

// This command runs with root tooling alone, before installing any provider package.
export function prepareBuildWorkspace(repoDirectory, targetDirectory) {
  const repository = realpathSync(resolve(repoDirectory));
  const target = emptyTarget(repository, targetDirectory);
  const projected = projectInputs(repository);
  for (const [project, manifest] of Object.entries(projected.manifests)) {
    const destination = join(target, project, "package.json");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const [fileName, value] of [
    ["pnpm-lock.yaml", projected.lockfile],
    ["pnpm-workspace.yaml", projected.workspace],
  ]) {
    writeFileSync(join(target, fileName), dump(value, { noRefs: true, lineWidth: -1 }));
  }
  const patches = join(repository, "patches");
  if (existsSync(patches)) {
    cpSync(patches, join(target, "patches"), { recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [repoDirectory, targetDirectory, ...extraArguments] = process.argv.slice(2);
    if (!repoDirectory || !targetDirectory || extraArguments.length > 0) {
      throw new Error("Usage: prepare-build-workspace <repo-directory> <target-directory>");
    }
    prepareBuildWorkspace(repoDirectory, targetDirectory);
    console.log(`Prepared selected build workspace at ${resolve(targetDirectory)}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
