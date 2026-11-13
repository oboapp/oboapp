import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { InstalledSourcePackage } from "./selection";

const dependenciesSchema = z.record(z.string(), z.string());
const manifestSchema = z.object({
  name: z.string().optional(),
  dependencies: dependenciesSchema.optional().default({}),
});
const sourceMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  localities: z.array(z.string().min(1)).min(1),
  experimental: z.boolean().optional(),
  emergent: z.boolean().optional(),
});
const supportPackages = new Set(["@oboapp/source-sdk", "@oboapp/source-web-utils"]);

export interface InstalledPackageManifest {
  directory: string;
  dependencies: Readonly<Record<string, string>>;
}

export interface InstalledSourcePackageDetails extends InstalledSourcePackage, InstalledPackageManifest {}

/** Find the owning manifest even when compiled entrypoints have a nested module-type manifest. */
export function readInstalledPackageManifest(
  packageName: string,
  resolvedEntrypoint: string,
): InstalledPackageManifest {
  let directory = dirname(resolvedEntrypoint);
  while (true) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
      if (manifest.name === packageName) {
        return { directory, dependencies: manifest.dependencies };
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot find installed package manifest for ${packageName}`);
    }
    directory = parent;
  }
}

/** Read declared source dependencies through their isolated metadata exports. */
export function readInstalledSourcePackages(ingestDirectory: string): InstalledSourcePackageDetails[] {
  const manifestPath = join(ingestDirectory, "package.json");
  const { dependencies } = z.object({ dependencies: dependenciesSchema }).parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const packageRequire = createRequire(manifestPath);
  return Object.entries(dependencies)
    .filter(([name]) => name.startsWith("@oboapp/source-") && !supportPackages.has(name))
    .map(([name, version]) => {
      const metadataPath = `${name}/metadata`;
      try {
        const resolvedMetadata = packageRequire.resolve(metadataPath);
        const { metadata } = z.object({ metadata: sourceMetadataSchema }).parse(packageRequire(metadataPath));
        const manifest = readInstalledPackageManifest(name, resolvedMetadata);
        return { name, version, metadata, ...manifest };
      } catch (error) {
        throw new Error(`Cannot read browser-safe source metadata from ${metadataPath}`, { cause: error });
      }
    });
}
