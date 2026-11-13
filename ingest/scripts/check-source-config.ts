import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { SOURCES } from "@oboapp/shared";
import { z } from "zod";
import { validateSourceSelection } from "@/sources/selection";
import { readInstalledSourcePackages } from "@/sources/installed-packages";

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

/** Read the same dependency and job data used by installation and Terraform. */
export function checkSourceConfiguration(
  ingestDirectory: string,
  runtimeDirectory = resolve(__dirname, ".."),
): void {
  const policyPath = join(ingestDirectory, "source-package-policy.json");
  const retainedUnselectedPackages = existsSync(policyPath)
    ? packagePolicySchema.parse(JSON.parse(readFileSync(policyPath, "utf8"))).retainedUnselectedPackages
    : [];
  const packages = readInstalledSourcePackages(ingestDirectory);
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
