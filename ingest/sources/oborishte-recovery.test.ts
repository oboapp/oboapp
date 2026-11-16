// @vitest-environment node

import { createHash } from "node:crypto";
import type { Command } from "commander";
import { chromium } from "playwright";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSourceStore } from "@/__mocks__/source-contract";

const mocks = vi.hoisted(() => ({
  program: undefined as Command | undefined,
  getDb: vi.fn(),
  sentry: {
    init: vi.fn(),
    isInitialized: vi.fn(),
    flush: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  },
  scope: {
    setExtra: vi.fn(),
    setLevel: vi.fn(),
    setTag: vi.fn(),
  },
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
vi.mock("@/sources/registry", () => ({
  getSelectedSourceIds: () => ["rayon-oborishte-bg"],
  runSelectedSource: async () => {
    const { crawl } = await import("@/crawlers/rayon-oborishte-bg/index");
    await crawl();
  },
}));
vi.mock("@sentry/node", () => ({
  ...mocks.sentry,
  withScope: (callback: (scope: typeof mocks.scope) => void) => {
    callback(mocks.scope);
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.program = undefined;
  mocks.sentry.flush.mockResolvedValue(true);
  mocks.sentry.isInitialized.mockReturnValue(true);
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    LOCALITY: "bg.sofia",
    SENTRY_DSN: "https://public@example.test/1",
    CLOUD_RUN_JOB: "crawl-oborishte",
    CLOUD_RUN_EXECUTION: "crawl-oborishte-recovery",
    CLOUD_RUN_TASK_INDEX: "0",
    CLOUD_RUN_TASK_ATTEMPT: "0",
  })) {
    vi.stubEnv(key, value);
  }
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("recovers a real packaged Oborishte scan and flushes one sanitized warning before exiting", async () => {
  const identifier = "https://rayon-oborishte.bg/Auction%2fPost/?x=1&y=2";
  const documentId = createHash("md5").update(identifier).digest("hex");
  const historical = { url: identifier, title: "Historical content", processed: true };
  const store = createSourceStore();
  store.records.set(documentId, historical);
  mocks.getDb.mockResolvedValue(store.db);
  const launch = vi.spyOn(chromium, "launch").mockRejectedValue(
    new Error("An existing identifier must not launch a browser"),
  );
  const privateUrl = "https://reader:password@rayon-oborishte.bg/feed/?token=private#fragment";
  const cause = Object.assign(new Error(`Connection reset for ${privateUrl}`), {
    code: "ECONNRESET",
    authorization: "private-error-property",
  });
  const failure = new TypeError("fetch failed", { cause });
  const fetchMock = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(Response.json([{
      link: identifier,
      title: { rendered: "Auction &amp; notice" },
      date_gmt: "2026-11-16T08:02:49",
      categories: [21],
    }]));
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

  await program.parseAsync(["node", "crawl", "--source", "rayon-oborishte-bg"]);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenNthCalledWith(1, "https://rayon-oborishte.bg/feed/", expect.objectContaining({
    headers: expect.objectContaining({ Accept: "application/rss+xml, application/xml, text/xml, */*" }),
    signal: expect.any(AbortSignal),
  }));
  expect(fetchMock).toHaveBeenNthCalledWith(2,
    "https://rayon-oborishte.bg/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc",
    expect.objectContaining({
      headers: expect.objectContaining({ Accept: "application/json" }),
      signal: expect.any(AbortSignal),
    }),
  );
  const logs = output.map((line) => {
    return JSON.parse(line) as Record<string, unknown>;
  });
  expect(logs.filter((entry) => entry.severity === "WARNING")).toEqual([
    expect.objectContaining({
      message: "RSS discovery failed; trying WordPress posts API",
      sourceType: "rayon-oborishte-bg",
      diagnosticCode: "rss-discovery-failure",
      cloudRunExecution: "crawl-oborishte-recovery",
      cloudRunTaskAttempt: "0",
      error: expect.objectContaining({
        message: "fetch failed",
        cause: expect.objectContaining({
          code: "ECONNRESET",
          message: "Connection reset for https://rayon-oborishte.bg/feed/",
        }),
      }),
    }),
  ]);
  expect(logs.some((entry) => entry.severity === "ERROR")).toBe(false);
  expect(logs).toContainEqual(expect.objectContaining({
    message: "Crawl complete",
    sourceType: "rayon-oborishte-bg",
    saved: 0,
    skipped: 1,
    failed: 0,
  }));
  expect(mocks.sentry.init).toHaveBeenCalledOnce();
  expect(mocks.sentry.captureException).toHaveBeenCalledOnce();
  expect(mocks.sentry.captureMessage).not.toHaveBeenCalled();
  expect(mocks.scope.setLevel).toHaveBeenCalledExactlyOnceWith("warning");
  expect(mocks.scope.setTag.mock.calls).toEqual([
    ["sourceType", "rayon-oborishte-bg"],
    ["diagnosticCode", "rss-discovery-failure"],
  ]);
  expect(mocks.scope.setExtra).toHaveBeenCalledWith("cloudRunExecution", "crawl-oborishte-recovery");
  const captured: Error = mocks.sentry.captureException.mock.calls[0][0];
  expect(captured).not.toBe(failure);
  expect(captured).toMatchObject({ name: "TypeError", message: "fetch failed" });
  expect(captured.cause).toBeInstanceOf(Error);
  const diagnostics = output.join("") + JSON.stringify(mocks.scope.setExtra.mock.calls)
    + captured.stack + (captured.cause as Error).stack;
  for (const secret of ["reader:", "password", "token=private", "#fragment", "private-error-property"]) {
    expect(diagnostics).not.toContain(secret);
  }
  expect(cause.message).toContain(privateUrl);
  expect(store.records.get(documentId)).toBe(historical);
  expect(store.sources.findById).toHaveBeenCalledWith(documentId);
  expect(store.client.createOne).not.toHaveBeenCalled();
  expect(store.sources.setOne).not.toHaveBeenCalled();
  expect(store.sources.updateOne).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
  expect(mocks.sentry.flush).toHaveBeenCalledExactlyOnceWith(5000);
  expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(mocks.sentry.flush.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(process.exit).mock.invocationCallOrder[0],
  );
});
