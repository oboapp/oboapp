// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ingestPackage from "../package.json";
import { checkSourceBrowsers, runSourceBrowserChecks } from "./check-source-browsers";

const mocks = vi.hoisted(() => ({
  createRequire: vi.fn(),
  packageRequire: vi.fn(),
  helperRequire: vi.fn(),
  resolve: vi.fn(),
  launch: vi.fn(),
  newPage: vi.fn(),
  setContent: vi.fn(),
  textContent: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:module", () => ({ createRequire: mocks.createRequire }));

const packages = [
  "@oboapp/source-rayon-oborishte-bg",
  "@oboapp/source-so-slatina-org",
  "@oboapp/source-lozenets-sofia-bg",
  "@oboapp/source-studentski-bg",
  "@oboapp/source-sredec-sofia-org",
  "@oboapp/source-rayon-ilinden-bg",
  "@oboapp/source-nadezhda-org",
  "@oboapp/source-raioniskar-bg",
  "@oboapp/source-mladost-bg",
  "@oboapp/source-vrabnitsa-org",
].filter((name) => Object.hasOwn(ingestPackage.dependencies, name));
const helperPath = "/mock/source-web-utils/index.js";
let originalExitCode: typeof process.exitCode;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.resetAllMocks();
  Object.assign(mocks.packageRequire, { resolve: mocks.resolve });
  mocks.resolve.mockReturnValue(helperPath);
  mocks.createRequire.mockImplementation((path: string) => {
    return path === helperPath ? mocks.helperRequire : mocks.packageRequire;
  });
  mocks.packageRequire.mockReturnValue({ chromium: { launch: mocks.launch } });
  mocks.helperRequire.mockReturnValue({ chromium: { launch: mocks.launch } });
  mocks.launch.mockResolvedValue({ newPage: mocks.newPage, close: mocks.close });
  mocks.newPage.mockResolvedValue({
    setContent: mocks.setContent,
    textContent: mocks.textContent,
  });
  mocks.textContent.mockResolvedValue("Browser check");
  mocks.close.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockReturnValue(undefined);
  vi.spyOn(console, "error").mockReturnValue(undefined);
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("source browser checks", () => {
  it("loads each package's own Playwright and closes each browser before moving on", async () => {
    await checkSourceBrowsers();

    const requirePaths: string[][] = [];
    for (const [index, source] of packages.entries()) {
      requirePaths.push([require.resolve(source)]);
      if (index >= 2) {
        requirePaths.push([helperPath]);
      }
    }
    expect(mocks.createRequire.mock.calls).toEqual(requirePaths);
    expect(mocks.packageRequire).toHaveBeenNthCalledWith(1, "playwright");
    expect(mocks.packageRequire).toHaveBeenNthCalledWith(2, "playwright");
    expect(mocks.packageRequire).toHaveBeenCalledTimes(2);
    expect(mocks.resolve).toHaveBeenCalledTimes(packages.length - 2);
    expect(mocks.resolve).toHaveBeenCalledWith("@oboapp/source-web-utils");
    expect(mocks.helperRequire).toHaveBeenCalledTimes(packages.length - 2);
    expect(mocks.helperRequire).toHaveBeenCalledWith("playwright");
    expect(mocks.launch).toHaveBeenCalledTimes(packages.length);
    expect(mocks.launch).toHaveBeenCalledWith({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    expect(mocks.setContent).toHaveBeenCalledWith("<p>Browser check</p>");
    expect(mocks.textContent).toHaveBeenCalledWith("p");
    expect(mocks.close).toHaveBeenCalledTimes(packages.length);
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.launch.mock.invocationCallOrder[1]);
    for (const source of packages) {
      expect(console.log).toHaveBeenCalledWith(`Chromium check passed for ${source}`);
    }
  });

  it.each(["resolve", "helperRequire"] as const)(
    "identifies a source whose nested browser dependency fails at %s",
    async (operation) => {
      const cause = new Error("Nested browser dependency unavailable");
      mocks[operation].mockImplementationOnce(() => {
        throw cause;
      });

      await expect(checkSourceBrowsers()).rejects.toMatchObject({
        message: `Chromium check failed for ${packages[2]}`,
        cause,
      });
      expect(mocks.close).toHaveBeenCalledTimes(2);
      expect(mocks.launch).toHaveBeenCalledTimes(2);
      expect(console.log).not.toHaveBeenCalledWith(`Chromium check passed for ${packages[2]}`);
    },
  );

  it.each(["createRequire", "packageRequire", "launch"] as const)(
    "identifies the failing package when %s fails before opening a browser",
    async (operation) => {
      const cause = new Error("Browser dependency unavailable");
      mocks[operation].mockImplementationOnce(() => {
        throw cause;
      });

      await expect(checkSourceBrowsers()).rejects.toMatchObject({
        message: `Chromium check failed for ${packages[0]}`,
        cause,
      });

      expect(mocks.close).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
      expect(mocks.createRequire).toHaveBeenCalledOnce();
    },
  );

  it.each(["newPage", "setContent", "textContent"] as const)(
    "closes the opened browser when %s fails and stops checking later packages",
    async (operation) => {
      const cause = new Error("Browser page unavailable");
      mocks[operation].mockRejectedValueOnce(cause);

      await expect(checkSourceBrowsers()).rejects.toMatchObject({
        message: `Chromium check failed for ${packages[0]}`,
        cause,
      });

      expect(mocks.close).toHaveBeenCalledOnce();
      expect(mocks.launch).toHaveBeenCalledOnce();
      expect(console.log).not.toHaveBeenCalled();
    },
  );

  it("rejects an incorrect rendered page and closes its browser", async () => {
    mocks.textContent.mockResolvedValueOnce("Unexpected page");

    await expect(checkSourceBrowsers()).rejects.toMatchObject({
      message: `Chromium check failed for ${packages[0]}`,
      cause: expect.objectContaining({ message: "Failed to render a page" }),
    });

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("reports a failed browser cleanup without claiming a successful check", async () => {
    const cause = new Error("Browser cleanup failed");
    mocks.close.mockRejectedValueOnce(cause);

    await expect(checkSourceBrowsers()).rejects.toMatchObject({
      message: `Chromium check failed for ${packages[0]}`,
      cause,
    });

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("leaves the CLI exit status successful when every source passes", async () => {
    await runSourceBrowserChecks();

    expect(process.exitCode).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(packages.length);
  });

  it("fails the CLI with the source-specific cause when a browser check fails", async () => {
    const cause = new Error("Chromium unavailable");
    mocks.launch.mockRejectedValueOnce(cause);

    await runSourceBrowserChecks();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Source Chromium check failed",
      expect.objectContaining({
        message: `Chromium check failed for ${packages[0]}`,
        cause,
      }),
    );
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
  });
});
