// @vitest-environment node

import type { Command } from "commander";
import type { createSource } from "@oboapp/source-rayon-oborishte-bg";
import { chromium } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceStore } from "@/__mocks__/source-contract";

const mocks = vi.hoisted(() => ({
  program: undefined as Command | undefined,
  getDb: vi.fn(),
  init: vi.fn(),
  isInitialized: vi.fn(),
  flush: vi.fn(),
  setExtra: vi.fn(),
  setLevel: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  createOborishteSource: vi.fn<typeof createSource>(),
}));

vi.mock("commander", async (importOriginal) => {
  const actual = await importOriginal<typeof import("commander")>();
  return {
    ...actual,
    Command: class extends actual.Command {
      constructor() {
        super();
        mocks.program = this;
      }

      parse(): this {
        return this;
      }
    },
  };
});
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("@/lib/verify-env", () => ({ verifyDbEnv: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@oboapp/source-rayon-oborishte-bg", () => ({
  createSource: mocks.createOborishteSource,
}));
vi.mock("@/sources/registry", () => ({
  getSelectedSourceIds: () => ["lozenets-sofia-bg", "rayon-oborishte-bg"],
  runSelectedSource: async (sourceType: string) => {
    if (sourceType === "rayon-oborishte-bg") {
      const { crawl } = await import("@/crawlers/rayon-oborishte-bg/index");
      await crawl();
      return;
    }
    const { crawl } = await import("@/crawlers/lozenets-sofia-bg/index");
    await crawl();
  },
}));
vi.mock("@sentry/node", () => ({
  init: mocks.init,
  isInitialized: mocks.isInitialized,
  flush: mocks.flush,
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
  withScope: (callback: (scope: {
    setExtra: typeof mocks.setExtra;
    setLevel: typeof mocks.setLevel;
    setTag: typeof mocks.setTag;
  }) => void) => {
    callback({
      setExtra: mocks.setExtra,
      setLevel: mocks.setLevel,
      setTag: mocks.setTag,
    });
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.program = undefined;
  mocks.flush.mockResolvedValue(true);
  mocks.isInitialized.mockReturnValue(true);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LOCALITY", "bg.sofia");
  vi.stubEnv("SENTRY_DSN", "https://public@example.test/1");
  vi.stubEnv("CLOUD_RUN_JOB", "crawl-lozenets");
  vi.stubEnv("CLOUD_RUN_EXECUTION", "crawl-lozenets-recovery");
  vi.stubEnv("CLOUD_RUN_TASK_INDEX", "0");
  vi.stubEnv("CLOUD_RUN_TASK_ATTEMPT", "0");
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("published RSS source failure diagnostics", () => {
  it("retains the fetch cause through the CLI and correlates a recovered scheduler attempt", async () => {
    const store = createSourceStore();
    mocks.getDb.mockResolvedValue(store.db);
    const launch = vi.spyOn(chromium, "launch").mockRejectedValue(
      new Error("An empty feed must not launch a browser"),
    );
    const privateUrl = "https://reader:password@lozenets.sofia.bg/feed/?token=private#fragment";
    const cause = Object.assign(new Error(`connection reset for ${privateUrl}`), {
      code: "ECONNRESET",
      authorization: "private-error-property",
    });
    const failure = new TypeError("fetch failed", { cause });
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>"));
    vi.stubGlobal("fetch", fetchMock);
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    await import("@/crawl");
    const program = mocks.program;
    if (!program) {
      throw new Error("The crawl command was not created");
    }

    await program.parseAsync(["node", "crawl", "--source", "lozenets-sofia-bg"]);

    const logs = output.map((line) => {
      return JSON.parse(line) as Record<string, unknown>;
    });
    expect(logs).toContainEqual(expect.objectContaining({
      severity: "ERROR",
      message: "Source lozenets-sofia-bg failed",
      sourceType: "lozenets-sofia-bg",
      cloudRunJob: "crawl-lozenets",
      cloudRunExecution: "crawl-lozenets-recovery",
      cloudRunTaskIndex: "0",
      cloudRunTaskAttempt: "0",
      error: expect.objectContaining({
        name: "TypeError",
        message: "fetch failed",
        cause: expect.objectContaining({
          code: "ECONNRESET",
          message: "connection reset for https://lozenets.sofia.bg/feed/",
        }),
      }),
    }));
    expect(mocks.captureException).toHaveBeenCalledOnce();
    const captured = mocks.captureException.mock.calls[0][0] as Error;
    expect(captured).toBeInstanceOf(Error);
    expect(captured).not.toBe(failure);
    expect(captured).toMatchObject({
      name: "TypeError",
      message: "fetch failed",
      cause: expect.objectContaining({ code: "ECONNRESET" }),
    });
    expect(captured.cause).toBeInstanceOf(Error);
    expect(mocks.setExtra).toHaveBeenCalledWith("sourceType", "lozenets-sofia-bg");
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunExecution", "crawl-lozenets-recovery");
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunTaskIndex", "0");
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunTaskAttempt", "0");
    const diagnostics = output.join("") + JSON.stringify(mocks.setExtra.mock.calls)
      + captured.stack + (captured.cause as Error).stack;
    for (const secret of ["reader:", "password", "token=private", "#fragment", "private-error-property"]) {
      expect(diagnostics).not.toContain(secret);
    }
    expect(failure.cause).toBe(cause);
    expect(cause.message).toContain(privateUrl);
    expect(process.exit).toHaveBeenNthCalledWith(1, 1);

    vi.stubEnv("CLOUD_RUN_TASK_ATTEMPT", "1");
    await program.parseAsync(["node", "crawl", "--source", "lozenets-sofia-bg"]);

    const recoveredLogs = output.map((line) => {
      return JSON.parse(line) as Record<string, unknown>;
    });
    expect(recoveredLogs).toContainEqual(expect.objectContaining({
      severity: "INFO",
      message: "Crawl complete",
      sourceType: "lozenets-sofia-bg",
      cloudRunExecution: "crawl-lozenets-recovery",
      cloudRunTaskIndex: "0",
      cloudRunTaskAttempt: "1",
      saved: 0,
      skipped: 0,
      failed: 0,
    }));
    expect(process.exit).toHaveBeenNthCalledWith(2, 0);
    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(mocks.flush).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      "https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(launch).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
  });

  it("reports recovered Oborishte discovery once as a warning while known items exit successfully", async () => {
    vi.stubEnv("CLOUD_RUN_JOB", "crawl-oborishte");
    vi.stubEnv("CLOUD_RUN_EXECUTION", "crawl-oborishte-recovery");
    const store = createSourceStore();
    const identifier = "https://rayon-oborishte.bg/%d1%80%d0%b5%d0%bc%d0%be%d0%bd%d1%82/?id=1";
    const historical = { url: identifier, title: "Historical content", processed: true };
    store.records.set("6513b033c4e69800675d8c7c11ab1f2f", historical);
    mocks.getDb.mockResolvedValue(store.db);
    const privateUrl = "https://reader:password@rayon-oborishte.bg/feed/?token=private#fragment";
    const failure = new TypeError("fetch failed", {
      cause: Object.assign(new Error(`Connection reset for ${privateUrl}`), {
        code: "ECONNRESET",
        authorization: "private-error-property",
      }),
    });
    const fetchItem = vi.fn();
    mocks.createOborishteSource.mockImplementation((_context, options) => ({
      async discoverItems() {
        await options?.onRssFailure?.(failure);
        return { items: [{ identifier }] };
      },
      fetchItem,
    }));
    const launch = vi.spyOn(chromium, "launch");
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    await import("@/crawl");
    const program = mocks.program;
    if (!program) {
      throw new Error("The crawl command was not created");
    }

    await program.parseAsync(["node", "crawl", "--source", "rayon-oborishte-bg"]);

    const logs = output.map((line) => {
      return JSON.parse(line) as Record<string, unknown>;
    });
    expect(logs.filter((entry) => entry.severity === "WARNING")).toEqual([
      expect.objectContaining({
        message: "RSS discovery failed; trying WordPress posts API",
        sourceType: "rayon-oborishte-bg",
        diagnosticCode: "rss-discovery-failure",
        feedUrl: "https://rayon-oborishte.bg/feed/",
        fallback: "wordpress-posts-api",
        cloudRunExecution: "crawl-oborishte-recovery",
        cloudRunTaskAttempt: "0",
        error: expect.objectContaining({
          message: "fetch failed",
          cause: expect.objectContaining({ code: "ECONNRESET" }),
        }),
      }),
    ]);
    expect(logs.some((entry) => entry.severity === "ERROR")).toBe(false);
    expect(logs).toContainEqual(expect.objectContaining({
      message: "Crawl complete",
      saved: 0,
      skipped: 1,
      failed: 0,
    }));
    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(mocks.setLevel).toHaveBeenCalledExactlyOnceWith("warning");
    expect(mocks.setTag.mock.calls).toEqual([
      ["sourceType", "rayon-oborishte-bg"],
      ["diagnosticCode", "rss-discovery-failure"],
    ]);
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunExecution", "crawl-oborishte-recovery");
    const captured: Error = mocks.captureException.mock.calls[0][0];
    const diagnostics = output.join("") + JSON.stringify(mocks.setExtra.mock.calls)
      + captured.stack + (captured.cause as Error).stack;
    for (const secret of ["reader:", "password", "token=private", "#fragment", "private-error-property"]) {
      expect(diagnostics).not.toContain(secret);
    }
    expect(store.records.get("6513b033c4e69800675d8c7c11ab1f2f")).toBe(historical);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(fetchItem).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(mocks.flush).toHaveBeenCalledExactlyOnceWith(5000);
  });
});
