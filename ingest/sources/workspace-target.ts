import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

/** Require fresh output outside source directories, allowing temporary and Docker staging paths. */
export function resolveEmptyWorkspaceTarget(repoDirectory: string, targetDirectory: string): string {
  const repository = realpathSync(resolve(repoDirectory));
  const target = resolveTarget(targetDirectory);
  if (isWithin(repository, target)) {
    throw new Error("Production workspace target must not contain the source repository");
  }
  if (isWithin(target, repository)) {
    const temporaryDirectory = join(repository, "tmp");
    const isTemporaryOutput = target !== temporaryDirectory && isWithin(target, temporaryDirectory);
    const isDockerOutput = target === join(repository, "production-workspace");
    if (!isTemporaryOutput && !isDockerOutput) {
      throw new Error("Production workspace target inside the repository must be under tmp or named production-workspace");
    }
  }
  if (existsSync(target)) {
    if (!statSync(target).isDirectory() || readdirSync(target).length > 0) {
      throw new Error("Production workspace target must be a new or empty directory");
    }
  }
  return target;
}
