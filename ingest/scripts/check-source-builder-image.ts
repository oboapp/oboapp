import { execFileSync } from "node:child_process";
import { resolveDockerExecutable } from "@/sources/docker-executable";
import { createSourceImageContentsVerifier } from "@/sources/source-image-verifier";

function createBuilderVerifier(): string {
  return `
${createSourceImageContentsVerifier("builder")}
console.log("Selected source builder excludes unselected provider packages and implementations");
`;
}

/** Inspect the two-source builder image without provider or database access. */
export function checkSourceBuilderImage(imageTag: string, explicitDockerExecutable?: string): void {
  if (!imageTag || imageTag.startsWith("-")) {
    throw new Error("A local source builder image tag is required");
  }
  const dockerExecutable = resolveDockerExecutable(explicitDockerExecutable);
  execFileSync(dockerExecutable, [
    "run", "--rm", "--pull", "never", "--network", "none", "--read-only",
    "--env", "COREPACK_ENABLE_NETWORK=0", "--workdir", "/app/ingest", "-i",
    "--entrypoint", "node", imageTag,
  ], {
    input: createBuilderVerifier(),
    stdio: ["pipe", "inherit", "inherit"],
    timeout: 60_000,
  });
  console.log(`Minimal source builder image checks passed for ${imageTag}`);
}

if (require.main === module) {
  try {
    const [imageTag, dockerExecutable, ...extraArguments] = process.argv.slice(2);
    if (!imageTag || extraArguments.length > 0) {
      throw new Error("Usage: check-source-builder-image <local-image-tag> [absolute-docker-executable]");
    }
    checkSourceBuilderImage(imageTag, dockerExecutable);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
