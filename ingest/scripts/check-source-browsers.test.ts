// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSourceBrowsers, runSourceBrowserChecks } from "./check-source-browsers";

const mocks = vi.hoisted(() => ({
  selectedIds: vi.fn(),
  loadPlaywright: vi.fn(),
  launch: vi.fn(),
  newPage: vi.fn(),
  setContent: vi.fn(),
  textContent: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/sources/registry", () => ({ getSelectedSourceIds: mocks.selectedIds }));

const directName = "@oboapp/source-direct";
const helperName = "@oboapp/source-nested";
const httpName = "@oboapp/source-http";
const unselectedName = "@oboapp/source-unselected";
let directory: string;
let directDirectory: string;
let helperDirectory: string;
let originalExitCode: typeof process.exitCode;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

function writeSource(name: string, id: string, dependencies: Record<string, string>): string {
  const packageDirectory = join(directory, "node_modules", name);
  const compiledDirectory = join(packageDirectory, "dist", "cjs");
  mkdirSync(compiledDirectory, { recursive: true });
  writeJson(join(packageDirectory, "package.json"), {
    name,
    dependencies,
    exports: { ".": "./dist/cjs/runtime.cjs", "./metadata": "./dist/cjs/metadata.cjs" },
  });
  writeJson(join(compiledDirectory, "package.json"), { type: "commonjs" });
  writeFileSync(join(compiledDirectory, "runtime.cjs"), "throw new Error('Source runtime was loaded');");
  writeFileSync(join(compiledDirectory, "metadata.cjs"), `exports.metadata = ${JSON.stringify({
    id,
    name: id,
    url: `https://example.com/${id}`,
    localities: ["bg.plovdiv"],
  })};`);
  return packageDirectory;
}

function writePlaywright(ownerDirectory: string, owner: string): void {
  const packageDirectory = join(ownerDirectory, "node_modules", "playwright");
  mkdirSync(packageDirectory, { recursive: true });
  writeJson(join(packageDirectory, "package.json"), { name: "playwright", main: "index.cjs" });
  writeFileSync(
    join(packageDirectory, "index.cjs"),
    `module.exports = globalThis.__oboSourceBrowserFixture(${JSON.stringify(owner)});`,
  );
}

function writeIngestManifest(names = [directName, helperName, httpName, unselectedName]): void {
  writeJson(join(directory, "package.json"), {
    dependencies: Object.fromEntries(names.map((name) => [name, "1.2.3"])),
  });
}

function writeUnavailableDependency(name: string): void {
  const packageDirectory = join(directory, "node_modules", name);
  mkdirSync(packageDirectory, { recursive: true });
  writeJson(join(packageDirectory, "package.json"), {
    name,
    exports: { ".": "./missing.cjs" },
  });
}

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.resetAllMocks();
  mocks.selectedIds.mockReturnValue(["district-news", "nested-news", "http-news"]);
  mocks.loadPlaywright.mockReturnValue({ chromium: { launch: mocks.launch } });
  mocks.launch.mockResolvedValue({ newPage: mocks.newPage, close: mocks.close });
  mocks.newPage.mockResolvedValue({ setContent: mocks.setContent, textContent: mocks.textContent });
  mocks.textContent.mockResolvedValue("Browser check");
  mocks.close.mockResolvedValue(undefined);
  vi.stubGlobal("__oboSourceBrowserFixture", mocks.loadPlaywright);
  vi.spyOn(console, "log").mockReturnValue(undefined);
  vi.spyOn(console, "error").mockReturnValue(undefined);

  directory = mkdtempSync(join(tmpdir(), "obo-source-browsers-"));
  directDirectory = writeSource(directName, "district-news", { playwright: "1.2.3" });
  const nestedSource = writeSource(helperName, "nested-news", { "@oboapp/source-web-utils": "1.2.3" });
  writeSource(httpName, "http-news", {});
  writeSource(unselectedName, "unselected-news", { "@oboapp/source-web-utils": "1.2.3" });
  helperDirectory = join(nestedSource, "node_modules", "@oboapp", "source-web-utils");
  mkdirSync(join(helperDirectory, "dist", "cjs"), { recursive: true });
  writeJson(join(helperDirectory, "package.json"), {
    name: "@oboapp/source-web-utils",
    dependencies: { playwright: "4.5.6" },
    exports: { ".": "./dist/cjs/index.js" },
  });
  writeJson(join(helperDirectory, "dist", "cjs", "package.json"), { type: "commonjs" });
  writeFileSync(join(helperDirectory, "dist", "cjs", "index.js"), "throw new Error('Helper runtime was loaded');");
  writePlaywright(directDirectory, "direct");
  writePlaywright(helperDirectory, "helper");
  writeIngestManifest();
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

describe("selected source browser checks", () => {
  it("loads each selected package's declared Playwright owner and closes browsers sequentially", async () => {
    await checkSourceBrowsers(directory);

    expect(mocks.loadPlaywright.mock.calls).toEqual([["direct"], ["helper"]]);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.launch).toHaveBeenCalledWith({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    expect(mocks.setContent).toHaveBeenCalledWith("<p>Browser check</p>");
    expect(mocks.textContent).toHaveBeenCalledWith("p");
    expect(mocks.close).toHaveBeenCalledTimes(2);
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.launch.mock.invocationCallOrder[1]);
    expect(console.log).toHaveBeenNthCalledWith(1, `Chromium check passed for ${directName}`);
    expect(console.log).toHaveBeenNthCalledWith(2, `Chromium check passed for ${helperName}`);
    expect(console.log).toHaveBeenCalledTimes(2);
  });

  it("supports a selected subset without installing any unselected source packages", async () => {
    writeIngestManifest([directName]);
    for (const name of [helperName, httpName, unselectedName]) {
      rmSync(join(directory, "node_modules", name), { recursive: true });
    }
    mocks.selectedIds.mockReturnValue(["district-news"]);

    await checkSourceBrowsers(directory);

    expect(mocks.loadPlaywright).toHaveBeenCalledExactlyOnceWith("direct");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("does not resolve a retained unselected package's missing browser helper", async () => {
    mocks.selectedIds.mockReturnValue(["http-news"]);

    await checkSourceBrowsers(directory);

    expect(mocks.loadPlaywright).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("does not mistake ingest's Playwright for an HTTP-only package dependency", async () => {
    writeIngestManifest([httpName]);
    writePlaywright(directory, "ingest fallback");
    mocks.selectedIds.mockReturnValue(["http-news"]);

    await checkSourceBrowsers(directory);

    expect(mocks.loadPlaywright).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("skips a selected helper that declares no browser dependency", async () => {
    writeJson(join(helperDirectory, "package.json"), {
      name: "@oboapp/source-web-utils",
      exports: { ".": "./dist/cjs/index.js" },
    });
    mocks.selectedIds.mockReturnValue(["nested-news"]);
    writePlaywright(directory, "ingest fallback");

    await checkSourceBrowsers(directory);

    expect(mocks.loadPlaywright).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("supports an instance without selected package runtimes", async () => {
    mocks.selectedIds.mockReturnValue([]);

    await checkSourceBrowsers(directory);

    expect(mocks.loadPlaywright).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it.each(["helper", "playwright"])("identifies a selected source whose nested %s is missing", async (dependency) => {
    const missingDirectory = dependency === "helper"
      ? helperDirectory
      : join(helperDirectory, "node_modules", "playwright");
    rmSync(missingDirectory, { recursive: true });
    writeUnavailableDependency(dependency === "helper" ? "@oboapp/source-web-utils" : "playwright");

    await expect(checkSourceBrowsers(directory)).rejects.toMatchObject({
      message: `Chromium check failed for ${helperName}`,
      cause: expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
    });

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalledWith(`Chromium check passed for ${helperName}`);
  });

  it("identifies a source whose declared direct Playwright is missing", async () => {
    rmSync(join(directDirectory, "node_modules", "playwright"), { recursive: true });
    writeUnavailableDependency("playwright");

    await expect(checkSourceBrowsers(directory)).rejects.toMatchObject({
      message: `Chromium check failed for ${directName}`,
      cause: expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
    });

    expect(mocks.launch).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("identifies a source whose browser dependency fails while loading", async () => {
    const cause = new Error("Browser dependency unavailable");
    mocks.loadPlaywright.mockImplementationOnce(() => {
      throw cause;
    });

    await expect(checkSourceBrowsers(directory)).rejects.toMatchObject({
      message: `Chromium check failed for ${directName}`,
      cause,
    });

    expect(mocks.close).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("identifies a source whose Chromium fails to launch", async () => {
    const cause = new Error("Chromium unavailable");
    mocks.launch.mockRejectedValueOnce(cause);

    await expect(checkSourceBrowsers(directory)).rejects.toMatchObject({
      message: `Chromium check failed for ${directName}`,
      cause,
    });

    expect(mocks.close).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each(["newPage", "setContent", "textContent"] as const)(
    "closes the opened browser when %s fails and stops checking later packages",
    async (operation) => {
      const cause = new Error("Browser page unavailable");
      mocks[operation].mockRejectedValueOnce(cause);

      await expect(checkSourceBrowsers(directory)).rejects.toMatchObject({
        message: `Chromium check failed for ${directName}`,
        cause,
      });

      expect(mocks.close).toHaveBeenCalledOnce();
      expect(mocks.launch).toHaveBeenCalledOnce();
      expect(console.log).not.toHaveBeenCalled();
    },
  );

  it("rejects an incorrect rendered page and closes its browser", async () => {
    mocks.textContent.mockResolvedValueOnce("Unexpected page");

    await expect(checkSourceBrowsers(directory)).rejects.toMatchObject({
      message: `Chromium check failed for ${directName}`,
      cause: expect.objectContaining({ message: "Failed to render a page" }),
    });

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("reports a failed browser cleanup without claiming a successful check", async () => {
    const cause = new Error("Browser cleanup failed");
    mocks.close.mockRejectedValueOnce(cause);

    await expect(checkSourceBrowsers(directory)).rejects.toMatchObject({
      message: `Chromium check failed for ${directName}`,
      cause,
    });

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("leaves the CLI exit status successful when every selected browser passes", async () => {
    await runSourceBrowserChecks(directory);

    expect(process.exitCode).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });

  it("fails the CLI with the source-specific cause when a browser check fails", async () => {
    const cause = new Error("Chromium unavailable");
    mocks.launch.mockRejectedValueOnce(cause);

    await runSourceBrowserChecks(directory);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Source Chromium check failed",
      expect.objectContaining({ message: `Chromium check failed for ${directName}`, cause }),
    );
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
  });
});
