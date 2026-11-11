import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { SOURCES } from "@oboapp/shared";
import { z } from "zod";
import { validateSourceSelection } from "@/sources/selection";

const sourceMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  localities: z.array(z.string().min(1)).min(1),
  experimental: z.boolean().optional(),
  emergent: z.boolean().optional(),
});
const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
});
const packagePolicySchema = z.object({
  retainedUnselectedPackages: z.array(z.string().min(1)),
}).strict();
const sourceJobsSchema = z.record(z.string(), z.object({
  source: z.string().min(1),
  memory: z.string().min(1),
  timeout: z.string().min(1),
  description: z.string().optional(),
  emergent: z.boolean().optional(),
}).strict());
const supportPackages = new Set(["@oboapp/source-sdk", "@oboapp/source-web-utils"]);

/** Read the same dependency and job data used by installation and Terraform. */
export function checkSourceConfiguration(
  ingestDirectory: string,
  runtimeDirectory = resolve(__dirname, ".."),
): void {
  const manifestPath = join(ingestDirectory, "package.json");
  const { dependencies } = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const policyPath = join(ingestDirectory, "source-package-policy.json");
  const retainedUnselectedPackages = existsSync(policyPath)
    ? packagePolicySchema.parse(JSON.parse(readFileSync(policyPath, "utf8"))).retainedUnselectedPackages
    : [];
  const packageRequire = createRequire(manifestPath);
  const packages = Object.entries(dependencies)
    .filter(([name]) => name.startsWith("@oboapp/source-") && !supportPackages.has(name))
    .map(([name, version]) => {
      const metadataPath = `${name}/metadata`;
      try {
        const { metadata } = z.object({ metadata: sourceMetadataSchema }).parse(packageRequire(metadataPath));
        return { name, version, metadata };
      } catch (error) {
        throw new Error(`Cannot read browser-safe source metadata from ${metadataPath}`, { cause: error });
      }
    });
  const terraformDirectory = join(ingestDirectory, "terraform");
  const jobsByLocality = Object.fromEntries(
    readdirSync(terraformDirectory)
      .filter((name) => name.startsWith("source-jobs.") && name.endsWith(".json"))
      .map((name) => {
        const locality = name.slice("source-jobs.".length, -".json".length);
        const jobs = sourceJobsSchema.parse(JSON.parse(readFileSync(join(terraformDirectory, name), "utf8")));
        return [locality, jobs];
      }),
  );
  const entrypointIds = SOURCES
    .filter((source) => existsSync(join(runtimeDirectory, "crawlers", source.id, `index${extname(__filename)}`)))
    .map((source) => source.id);
  validateSourceSelection({ catalog: SOURCES, packages, retainedUnselectedPackages, entrypointIds, jobsByLocality });
}

if (require.main === module) {
  try {
    checkSourceConfiguration(process.cwd());
    console.log("Source catalog, packages, entrypoints and deployment jobs agree");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
