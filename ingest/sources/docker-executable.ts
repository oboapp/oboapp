import { accessSync, constants, statSync } from "node:fs";
import { platform } from "node:os";
import { isAbsolute } from "node:path";

function standardDockerPaths(): readonly string[] {
  switch (platform()) {
    case "win32": {
      return [String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe`];
    }
    case "linux": {
      return ["/usr/bin/docker", "/usr/local/bin/docker"];
    }
    case "darwin": {
      return [
        "/Applications/Docker.app/Contents/Resources/bin/docker",
        "/usr/local/bin/docker",
        "/opt/homebrew/bin/docker",
      ];
    }
    default: {
      return [];
    }
  }
}

function isExecutableFile(fileName: string): boolean {
  try {
    if (!statSync(fileName).isFile()) {
      return false;
    }
    accessSync(fileName, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveDockerExecutable(explicitExecutable?: string): string {
  if (explicitExecutable !== undefined) {
    if (!isAbsolute(explicitExecutable)) {
      throw new Error("A custom Docker executable must use an absolute path");
    }
    if (!isExecutableFile(explicitExecutable)) {
      throw new Error(`Docker executable is missing or cannot be executed: ${explicitExecutable}`);
    }
    return explicitExecutable;
  }
  const executable = standardDockerPaths().find((candidate) => isExecutableFile(candidate));
  if (!executable) {
    throw new Error("Docker was not found in a standard installation directory; pass an absolute path for a custom installation");
  }
  return executable;
}
