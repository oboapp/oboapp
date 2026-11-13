// @vitest-environment node

import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSourceImage } from "./check-source-image";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  statSync: vi.fn(),
  accessSync: vi.fn(),
  platform: vi.fn(),
  readInstalledPackageManifest: vi.fn(),
  readInstalledSourcePackages: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  statSync: mocks.statSync,
  accessSync: mocks.accessSync,
}));
vi.mock("node:os", () => ({ platform: mocks.platform }));
vi.mock("@/sources/installed-packages", () => ({
  readInstalledPackageManifest: mocks.readInstalledPackageManifest,
  readInstalledSourcePackages: mocks.readInstalledSourcePackages,
}));

type DockerStage = "inspect" | "startup" | "version" | "verification";

const imageTag = "oboapp-source-fixture:test";
const defaultExecutable = "/usr/bin/docker";
let availableExecutables: Set<string>;
let configuredUser: string;
let pnpmVersion: string;
let failedStage: DockerStage | undefined;
let dockerFailure: Error;

function commandStage(args: readonly string[]): DockerStage {
  if (args[0] === "image") {
    return "inspect";
  }
  if (args.includes("--entrypoint")) {
    return "verification";
  }
  if (args.includes("--version")) {
    return "version";
  }
  return "startup";
}

function optionValue(args: readonly string[], option: string): string | undefined {
  const inlineOption = args.find((argument) => argument.startsWith(`${option}=`));
  if (inlineOption !== undefined) {
    return inlineOption.slice(option.length + 1);
  }
  const index = args.indexOf(option);
  if (index >= 0) {
    return args[index + 1];
  }
  return undefined;
}

beforeEach(() => {
  vi.resetAllMocks();
  configuredUser = "node";
  pnpmVersion = "10.11.0";
  failedStage = undefined;
  dockerFailure = new Error("Docker could not run the requested image");
  availableExecutables = new Set([defaultExecutable]);
  mocks.platform.mockReturnValue("linux");
  mocks.statSync.mockImplementation((fileName: string) => {
    if (!availableExecutables.has(fileName)) {
      throw new Error("The executable does not exist");
    }
    return { isFile: () => true };
  });
  mocks.execFileSync.mockImplementation((_command: string, args: readonly string[]) => {
    const stage = commandStage(args);
    if (stage === failedStage) {
      throw dockerFailure;
    }
    if (stage === "inspect") {
      return `${configuredUser}\n`;
    }
    if (stage === "version") {
      return `${pnpmVersion}\n`;
    }
    return "";
  });
  mocks.readInstalledPackageManifest.mockReturnValue({ directory: "/fixture/ingest", dependencies: {} });
  mocks.readInstalledSourcePackages.mockReturnValue([
    { name: "@oboapp/source-triaditsa-org" },
    { name: "@oboapp/source-rayon-oborishte-bg" },
  ]);
  vi.spyOn(console, "log").mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("source image verification safeguards", () => {
  it.each(["", "--privileged", "-v"])("rejects the invalid image tag %j before invoking Docker", (tag) => {
    expect(() => checkSourceImage(tag)).toThrow("A local source image tag is required");
    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.statSync).not.toHaveBeenCalled();
  });

  it("rejects a relative custom executable before invoking Docker", () => {
    expect(() => checkSourceImage(imageTag, "docker")).toThrow(/absolute path/);
    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.statSync).not.toHaveBeenCalled();
  });

  it("uses a custom absolute executable instead of searching standard locations", () => {
    const customExecutable = resolve("custom-tools", "docker");
    availableExecutables = new Set([customExecutable]);
    mocks.platform.mockReturnValue("aix");

    checkSourceImage(imageTag, customExecutable);

    expect(new Set(mocks.execFileSync.mock.calls.map(([executable]) => executable))).toEqual(new Set([customExecutable]));
  });

  it("refuses a missing custom executable without falling back to a different installation", () => {
    expect(() => checkSourceImage(imageTag, resolve("missing-tools", "docker"))).toThrow(/missing or cannot be executed/);
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it.each([
    {
      platform: "win32",
      executables: ["C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"],
      expected: "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    },
    {
      platform: "linux",
      executables: ["/usr/bin/docker", "/usr/local/bin/docker"],
      expected: "/usr/bin/docker",
    },
    {
      platform: "linux",
      executables: ["/usr/local/bin/docker"],
      expected: "/usr/local/bin/docker",
    },
    {
      platform: "darwin",
      executables: ["/Applications/Docker.app/Contents/Resources/bin/docker", "/usr/local/bin/docker"],
      expected: "/Applications/Docker.app/Contents/Resources/bin/docker",
    },
    {
      platform: "darwin",
      executables: ["/usr/local/bin/docker"],
      expected: "/usr/local/bin/docker",
    },
    {
      platform: "darwin",
      executables: ["/opt/homebrew/bin/docker"],
      expected: "/opt/homebrew/bin/docker",
    },
  ])("resolves the standard $platform installation at $expected", ({ platform, executables, expected }) => {
    mocks.platform.mockReturnValue(platform);
    availableExecutables = new Set(executables);

    checkSourceImage(imageTag);

    expect(new Set(mocks.execFileSync.mock.calls.map(([executable]) => executable))).toEqual(new Set([expected]));
  });

  it("skips a standard installation that cannot be executed", () => {
    availableExecutables.add("/usr/local/bin/docker");
    mocks.accessSync.mockImplementation((fileName: string) => {
      if (fileName === defaultExecutable) {
        throw new Error("Permission denied");
      }
    });

    checkSourceImage(imageTag);

    expect(new Set(mocks.execFileSync.mock.calls.map(([executable]) => executable))).toEqual(new Set(["/usr/local/bin/docker"]));
  });

  it("refuses a directory passed as the custom executable", () => {
    mocks.statSync.mockReturnValue({ isFile: () => false });

    expect(() => checkSourceImage(imageTag, resolve("custom-tools"))).toThrow(/missing or cannot be executed/);
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it.each(["linux", "aix"])("fails clearly without a standard %s installation", (platform) => {
    mocks.platform.mockReturnValue(platform);
    availableExecutables.clear();

    expect(() => checkSourceImage(imageTag)).toThrow(/not found in a standard installation directory/);
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it("refuses an image configured as root before launching a container", () => {
    configuredUser = "root";

    expect(() => checkSourceImage(imageTag)).toThrow("The Docker image must declare USER node");

    const launched = mocks.execFileSync.mock.calls.filter(([, args]) => args[0] === "run");
    expect(launched).toEqual([]);
  });

  it("disables networking and image pulls for every launched container", () => {
    checkSourceImage(imageTag);

    const launched = mocks.execFileSync.mock.calls.filter(([, args]) => args[0] === "run");
    expect(launched.length).toBeGreaterThan(0);
    for (const [command, args, options] of launched) {
      expect(command).toBe(defaultExecutable);
      expect(optionValue(args, "--network")).toBe("none");
      expect(optionValue(args, "--pull")).toBe("never");
      expect(args).toContain("COREPACK_ENABLE_NETWORK=0");
      expect(options?.shell ?? false).toBe(false);
    }
  });

  it("runs the read-only verifier with the image's configured user", () => {
    checkSourceImage(imageTag);

    const verificationRuns = mocks.execFileSync.mock.calls.filter(([, args]) => {
      return args.includes("--read-only") || args.includes("--read-only=true");
    });
    expect(verificationRuns.length).toBeGreaterThan(0);
    for (const [, args, options] of verificationRuns) {
      expect(optionValue(args, "--entrypoint")).toBe("node");
      expect(args.some((argument: string) => /^(?:--user(?:=|$)|-u)/.test(argument))).toBe(false);
      expect(options.input).toEqual(expect.any(String));
      expect(options.input.trim().length).toBeGreaterThan(0);
    }
  });

  it("rechecks module isolation after the browser compatibility check", () => {
    checkSourceImage(imageTag);

    const verificationRun = mocks.execFileSync.mock.calls.find(([, args]) => args.includes("--read-only"));
    expect(verificationRun).toBeDefined();
    const script: string = verificationRun?.[2].input;
    const browserCheck = script.indexOf('await require("./dist/scripts/check-source-browsers.js").checkSourceBrowsers();');
    expect(browserCheck).toBeGreaterThan(0);
    expect(script.indexOf("verifySourceModuleIsolation();", browserCheck)).toBeGreaterThan(browserCheck);
  });

  it("reports a pnpm version that differs from the production pin", () => {
    pnpmVersion = "10.12.0";

    expect(() => checkSourceImage(imageTag)).toThrow(/pinned pnpm version/);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("checks passed"));
  });

  it.each<DockerStage>(["inspect", "startup", "version", "verification"])(
    "propagates Docker failures during %s",
    (stage) => {
      failedStage = stage;
      let caught: unknown;
      try {
        checkSourceImage(imageTag);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBe(dockerFailure);
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("checks passed"));
    },
  );
});
