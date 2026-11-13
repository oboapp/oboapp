import { copyFileSync, cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { readInstalledSourcePackages } from "@/sources/installed-packages";
import { resolveEmptyWorkspaceTarget } from "@/sources/workspace-target";

const selectedIds = ["triaditsa-org", "sofiyska-voda"];
const sourceJobsSchema = z.record(z.string(), z.object({ source: z.string() }).passthrough());
const excludedDirectories = new Set([
  "node_modules", "dist", "tmp", "coverage", ".terraform", ".cache", ".next", ".git",
  "__tests__", "tests", "emulator-data",
]);

function shouldCopySource(sourceRoot: string, source: string, isIngest: boolean): boolean {
  const parts = relative(sourceRoot, source).split(sep);
  if (parts.some((part) => excludedDirectories.has(part))) {
    return false;
  }
  const name = basename(source);
  if (
    name.startsWith(".env") || name.includes(".tfstate") || name.endsWith(".tsbuildinfo") ||
    /\.(?:test|spec)\.[cm]?tsx?$/.test(name) ||
    /^terraform\.tfvars(?:\.json)?$/.test(name) || /\.auto\.tfvars(?:\.json)?$/.test(name)
  ) {
    return false;
  }
  if (!isIngest) {
    return true;
  }
  if (parts[0] === "crawlers" && parts.length > 1) {
    return parts[1] === "shared" || selectedIds.includes(parts[1]);
  }
  if (parts[0] === "terraform" && parts.length === 2 && /^source-jobs\..+\.json$/.test(name)) {
    return false;
  }
  return parts[0] !== "source-package-policy.json";
}

function readSelectedJobs(repository: string) {
  const examplePath = join(repository, "ingest", "terraform", "examples", "source-jobs.bg.sofia.json");
  const jobs = sourceJobsSchema.parse(JSON.parse(readFileSync(examplePath, "utf8")));
  const selectedJobs = Object.entries(jobs).filter(([, job]) => selectedIds.includes(job.source));
  for (const sourceId of selectedIds) {
    if (selectedJobs.filter(([, job]) => job.source === sourceId).length !== 1) {
      throw new Error(`Expected one canonical image fixture job for ${sourceId}`);
    }
  }
  return Object.fromEntries(selectedJobs);
}

/** Create an isolated two-source Docker context while retaining development package dependencies. */
export function prepareSourceImageFixture(repoDirectory: string, targetDirectory: string): void {
  const repository = realpathSync(resolve(repoDirectory));
  const target = resolveEmptyWorkspaceTarget(repository, targetDirectory);
  const jobs = readSelectedJobs(repository);
  const retainedPackages = readInstalledSourcePackages(join(repository, "ingest"))
    .filter((source) => !selectedIds.includes(source.metadata.id))
    .map((source) => source.name);

  mkdirSync(target, { recursive: true });
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".dockerignore"]) {
    copyFileSync(join(repository, name), join(target, name));
  }
  cpSync(join(repository, "patches"), join(target, "patches"), { recursive: true });
  for (const name of ["shared", "db", "ingest"]) {
    const sourceRoot = join(repository, name);
    cpSync(sourceRoot, join(target, name), {
      recursive: true,
      filter: (source) => shouldCopySource(sourceRoot, source, name === "ingest"),
    });
  }

  const sourceAssembly = [
    'export type { SourceDefinition } from "./source-definition";',
    'import triaditsaOrg from "./sources/triaditsa-org";',
    'import sofiyskaVoda from "./sources/sofiyska-voda";',
    "",
    "export const SOURCES = [triaditsaOrg, sofiyskaVoda] as const;",
    "export const EMERGENT_CRAWLERS: readonly string[] = SOURCES",
    "  .filter((source) => source.emergent)",
    "  .map((source) => source.id);",
    "",
  ].join("\n");
  writeFileSync(join(target, "shared", "src", "sources.ts"), sourceAssembly);
  writeFileSync(join(target, "ingest", "source-package-policy.json"), `${JSON.stringify({
    retainedUnselectedPackages: retainedPackages,
  }, null, 2)}\n`);
  writeFileSync(join(target, "ingest", "terraform", "source-jobs.bg.sofia.json"), `${JSON.stringify(jobs, null, 2)}\n`);
}

if (require.main === module) {
  try {
    const [targetDirectory, ...extraArguments] = process.argv.slice(2);
    if (!targetDirectory || extraArguments.length > 0) {
      throw new Error("Usage: prepare-source-image-fixture <target-directory>");
    }
    const repository = resolve(__dirname, extname(__filename) === ".ts" ? "../.." : "../../..");
    prepareSourceImageFixture(repository, targetDirectory);
    console.log(`Prepared minimal source image fixture at ${resolve(targetDirectory)}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
