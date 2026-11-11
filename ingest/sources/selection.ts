import type { SourceMetadata } from "@oboapp/source-sdk";

export interface InstalledSourcePackage {
  name: string;
  version: string;
  metadata: SourceMetadata;
}

export interface SourceJob {
  source: string;
  emergent?: boolean;
}

export interface SourceSelection {
  catalog: readonly SourceMetadata[];
  packages: readonly InstalledSourcePackage[];
  retainedUnselectedPackages?: readonly string[];
  entrypointIds: readonly string[];
  jobsByLocality: Readonly<Record<string, Readonly<Record<string, SourceJob>>>>;
}

function validVersionIdentifiers(value: string, allowNumericLeadingZeros: boolean): boolean {
  return value.split(".").every((identifier) => {
    if (!/^[0-9A-Za-z-]+$/.test(identifier)) {
      return false;
    }
    if (allowNumericLeadingZeros || !/^[0-9]+$/.test(identifier)) {
      return true;
    }
    return identifier === "0" || !identifier.startsWith("0");
  });
}

function isExactVersion(value: string): boolean {
  const [version, build, ...extraBuildParts] = value.split("+");
  if (extraBuildParts.length > 0) {
    return false;
  }
  if (build !== undefined && !validVersionIdentifiers(build, true)) {
    return false;
  }
  const prereleaseIndex = version.indexOf("-");
  const core = prereleaseIndex < 0 ? version : version.slice(0, prereleaseIndex);
  const parts = core.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^(?:0|[1-9][0-9]*)$/.test(part))) {
    return false;
  }
  return prereleaseIndex < 0 || validVersionIdentifiers(version.slice(prereleaseIndex + 1), false);
}

function validatePackageMetadata(
  source: SourceMetadata,
  selected: InstalledSourcePackage,
  errors: string[],
): void {
  for (const field of ["name", "url", "experimental", "emergent"] as const) {
    if ((source[field] ?? false) !== (selected.metadata[field] ?? false)) {
      errors.push(`${selected.name} metadata ${field} differs from catalog source ${source.id}`);
    }
  }
  for (const locality of source.localities) {
    if (!selected.metadata.localities.includes(locality)) {
      errors.push(`${selected.name} does not support catalog locality ${locality}`);
    }
  }
}

function validateRetainedPackages(
  catalog: ReadonlyMap<string, SourceMetadata>,
  packages: readonly InstalledSourcePackage[],
  retainedNames: readonly string[],
  errors: string[],
): ReadonlySet<string> {
  const retained = new Set<string>();
  const installed = new Map(packages.map((sourcePackage) => [sourcePackage.name, sourcePackage]));
  for (const name of retainedNames) {
    if (retained.has(name)) {
      errors.push(`Retained unselected package ${name} is listed more than once`);
    }
    retained.add(name);
    const sourcePackage = installed.get(name);
    if (!sourcePackage) {
      errors.push(`Retained unselected package ${name} is not installed`);
    } else if (catalog.has(sourcePackage.metadata.id)) {
      errors.push(`Retained unselected package ${name} is selected; remove it from the retention policy`);
    }
  }
  return retained;
}

function validatePackages(
  catalog: ReadonlyMap<string, SourceMetadata>,
  packages: readonly InstalledSourcePackage[],
  retainedNames: readonly string[],
  errors: string[],
): void {
  const retained = validateRetainedPackages(catalog, packages, retainedNames, errors);
  const packagedIds = new Set<string>();
  for (const selected of packages) {
    const { metadata } = selected;
    if (packagedIds.has(metadata.id)) {
      errors.push(`Multiple packages provide source ${metadata.id}`);
    }
    packagedIds.add(metadata.id);
    if (!isExactVersion(selected.version)) {
      errors.push(`${selected.name} must use an exact package version`);
    }
    const source = catalog.get(metadata.id);
    if (!source) {
      if (!retained.has(selected.name)) {
        errors.push(`${selected.name} provides unselected source ${metadata.id}`);
      }
      continue;
    }
    validatePackageMetadata(source, selected, errors);
  }
}

function validateLocalityJobs(
  catalog: ReadonlyMap<string, SourceMetadata>,
  locality: string,
  jobs: Readonly<Record<string, SourceJob>>,
  jobKeys: Set<string>,
  errors: string[],
): void {
  const sourceIds = new Set<string>();
  for (const [key, job] of Object.entries(jobs)) {
    if (jobKeys.has(key)) {
      errors.push(`Deployment job key ${key} is reused across localities`);
    }
    jobKeys.add(key);
    if (sourceIds.has(job.source)) {
      errors.push(`Multiple deployment jobs select ${job.source} in ${locality}`);
    }
    sourceIds.add(job.source);
    const source = catalog.get(job.source);
    if (!source?.localities.includes(locality)) {
      errors.push(`Deployment job ${key} selects ${job.source} outside the ${locality} catalog`);
    } else if ((job.emergent ?? false) !== (source.emergent ?? false)) {
      errors.push(`Deployment job ${key} emergent schedule differs from catalog source ${source.id}`);
    }
  }
  for (const source of catalog.values()) {
    if (source.localities.includes(locality) && !sourceIds.has(source.id)) {
      errors.push(`Catalog source ${source.id} has no deployment job in ${locality}`);
    }
  }
}

function validateJobs(
  catalog: ReadonlyMap<string, SourceMetadata>,
  jobsByLocality: SourceSelection["jobsByLocality"],
  errors: string[],
): void {
  const jobKeys = new Set<string>();
  for (const [locality, jobs] of Object.entries(jobsByLocality)) {
    validateLocalityJobs(catalog, locality, jobs, jobKeys, errors);
  }
  for (const source of catalog.values()) {
    for (const locality of source.localities) {
      if (!Object.hasOwn(jobsByLocality, locality)) {
        errors.push(`Catalog locality ${locality} has no deployment job configuration`);
      }
    }
  }
}

/** Check the instance selection without loading source runtimes or the database. */
export function validateSourceSelection(selection: SourceSelection): void {
  const errors: string[] = [];
  const catalog = new Map<string, SourceMetadata>();
  const entrypoints = new Set(selection.entrypointIds);
  for (const source of selection.catalog) {
    if (catalog.has(source.id)) {
      errors.push(`Duplicate catalog source ${source.id}`);
    }
    catalog.set(source.id, source);
    if (source.localities.length === 0) {
      errors.push(`Catalog source ${source.id} has no localities`);
    }
    if (!entrypoints.has(source.id)) {
      errors.push(`Catalog source ${source.id} has no crawler entrypoint`);
    }
  }
  validatePackages(catalog, selection.packages, selection.retainedUnselectedPackages ?? [], errors);
  validateJobs(catalog, selection.jobsByLocality, errors);
  if (errors.length > 0) {
    throw new Error(`Invalid source selection:\n${errors.join("\n")}`);
  }
}
