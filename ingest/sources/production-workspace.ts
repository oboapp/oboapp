import { z } from "zod";
import { isSourceImplementationPackage } from "./installed-packages";
import type { InstalledSourcePackage } from "./selection";

const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const projectPaths = [".", "ingest", "shared", "db"] as const;
const dependenciesSchema = z.record(z.string(), z.string());
const manifestSchema = z.object({
  dependencies: dependenciesSchema.optional(),
  devDependencies: dependenciesSchema.optional(),
  optionalDependencies: dependenciesSchema.optional(),
  peerDependencies: dependenciesSchema.optional(),
}).passthrough();
const lockedDependencySchema = z.object({
  specifier: z.string(),
  version: z.string(),
}).passthrough();
const importerDependenciesSchema = z.record(z.string(), lockedDependencySchema);
const importerSchema = z.object({
  dependencies: importerDependenciesSchema.optional(),
  devDependencies: importerDependenciesSchema.optional(),
  optionalDependencies: importerDependenciesSchema.optional(),
}).passthrough();
const lockfileSchema = z.object({
  lockfileVersion: z.union([z.literal("9.0"), z.literal(9)]),
  importers: z.record(z.string(), importerSchema),
}).passthrough();
const workspaceSchema = z.object({ packages: z.array(z.string()) }).passthrough();

export interface ProductionWorkspaceInput {
  manifests: Record<typeof projectPaths[number], unknown>;
  lockfile: unknown;
  workspace: unknown;
  packages: readonly InstalledSourcePackage[];
  selectedIds: readonly string[];
}

function effectiveDependencyGroup(
  manifest: z.infer<typeof manifestSchema>,
  name: string,
): typeof dependencyGroups[number] {
  if (Object.hasOwn(manifest.optionalDependencies ?? {}, name)) {
    return "optionalDependencies";
  }
  if (Object.hasOwn(manifest.dependencies ?? {}, name)) {
    return "dependencies";
  }
  return "devDependencies";
}

function validateImporter(
  project: string,
  manifest: z.infer<typeof manifestSchema>,
  importer: z.infer<typeof importerSchema>,
): void {
  for (const group of dependencyGroups) {
    for (const [name, specifier] of Object.entries(manifest[group] ?? {})) {
      if (effectiveDependencyGroup(manifest, name) !== group) {
        continue;
      }
      if (importer[group]?.[name]?.specifier !== specifier) {
        throw new Error(`Lockfile importer ${project} does not match ${group}.${name}`);
      }
    }
    for (const [name, dependency] of Object.entries(importer[group] ?? {})) {
      const declared = manifest[group]?.[name] ?? manifest.peerDependencies?.[name];
      if (declared !== dependency.specifier) {
        throw new Error(`Lockfile importer ${project} has an undeclared or mismatched ${group}.${name}`);
      }
    }
  }
}

/** Project direct dependencies while pnpm retains ownership of the transitive install graph. */
export function projectProductionWorkspace(input: ProductionWorkspaceInput) {
  const manifests = {
    ".": manifestSchema.parse(input.manifests["."]),
    ingest: manifestSchema.parse(input.manifests.ingest),
    shared: manifestSchema.parse(input.manifests.shared),
    db: manifestSchema.parse(input.manifests.db),
  };
  const lockfile = lockfileSchema.parse(structuredClone(input.lockfile));
  const workspace = workspaceSchema.parse(input.workspace);
  const importers: z.infer<typeof lockfileSchema>["importers"] = {};
  for (const project of projectPaths) {
    const importer = lockfile.importers[project];
    if (!importer) {
      throw new Error(`Missing lockfile importer ${project}`);
    }
    validateImporter(project, manifests[project], importer);
    importers[project] = importer;
  }
  lockfile.importers = importers;

  const sourcesByPackage = new Map(input.packages.map((source) => [source.name, source]));
  const productionDependencies = {
    ...manifests.ingest.dependencies,
    ...manifests.ingest.optionalDependencies,
  };
  for (const [name, version] of Object.entries(productionDependencies)) {
    if (!isSourceImplementationPackage(name)) {
      continue;
    }
    if (sourcesByPackage.get(name)?.version !== version) {
      throw new Error(`Missing or mismatched source package metadata for ${name}`);
    }
  }
  const selectedIds = new Set(input.selectedIds);
  for (const source of input.packages) {
    if (selectedIds.has(source.metadata.id)) {
      continue;
    }
    for (const group of dependencyGroups) {
      delete manifests.ingest[group]?.[source.name];
      delete lockfile.importers.ingest[group]?.[source.name];
    }
  }
  workspace.packages = ["ingest", "shared", "db"];
  return { manifests, lockfile, workspace };
}
