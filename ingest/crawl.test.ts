// @vitest-environment node

import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  program: undefined as Command | undefined,
  configureEnv: vi.fn(),
  verifyDbEnv: vi.fn(),
  initSentry: vi.fn(),
  flushSentry: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  getSelectedSourceIds: vi.fn(),
  runSelectedSource: vi.fn(),
  writeOut: vi.fn(),
  writeErr: vi.fn(),
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
vi.mock("dotenv", () => ({ default: { config: mocks.configureEnv } }));
vi.mock("@/lib/verify-env", () => ({ verifyDbEnv: mocks.verifyDbEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, error: mocks.error } }));
vi.mock("@/lib/sentry", () => ({ initSentry: mocks.initSentry, flushSentry: mocks.flushSentry }));
vi.mock("@/sources/registry", () => ({
  getSelectedSourceIds: mocks.getSelectedSourceIds,
  runSelectedSource: mocks.runSelectedSource,
}));

async function createProgram(): Promise<Command> {
  await import("./crawl");
  const program = mocks.program;
  if (!program) {
    throw new Error("The crawl command was not created");
  }
  program.configureOutput({ writeOut: mocks.writeOut, writeErr: mocks.writeErr });
  program.exitOverride();
  return program;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.program = undefined;
  mocks.getSelectedSourceIds.mockReturnValue(["district-news", "water-alerts"]);
  mocks.runSelectedSource.mockResolvedValue(undefined);
  mocks.flushSentry.mockResolvedValue(undefined);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selected-source crawl command", () => {
  it("shows selected sources in help without loading environment or source runtimes", async () => {
    const program = await createProgram();

    await expect(program.parseAsync(["node", "crawl", "--help"])).rejects.toMatchObject({
      code: "commander.helpDisplayed",
    });

    const output = mocks.writeOut.mock.calls.map(([text]) => text).join("");
    expect(output).toContain("district-news");
    expect(output).toContain("water-alerts");
    expect(output).not.toContain("sensor-community");
    expect(mocks.configureEnv).not.toHaveBeenCalled();
    expect(mocks.verifyDbEnv).not.toHaveBeenCalled();
    expect(mocks.initSentry).not.toHaveBeenCalled();
    expect(mocks.runSelectedSource).not.toHaveBeenCalled();
  });

  it("rejects an unselected source before checking credentials or loading its runtime", async () => {
    const program = await createProgram();

    await program.parseAsync(["node", "crawl", "--source", "sensor-community"]);

    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        source: "sensor-community",
        availableSources: ["district-news", "water-alerts"],
      }),
    );
    expect(mocks.verifyDbEnv).not.toHaveBeenCalled();
    expect(mocks.initSentry).not.toHaveBeenCalled();
    expect(mocks.runSelectedSource).not.toHaveBeenCalled();
  });

  it("loads environment and validates credentials before running the selected source", async () => {
    const program = await createProgram();

    await program.parseAsync(["node", "crawl", "--source", "district-news"]);

    expect(mocks.runSelectedSource).toHaveBeenCalledExactlyOnceWith("district-news");
    expect(mocks.configureEnv.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyDbEnv.mock.invocationCallOrder[0],
    );
    expect(mocks.verifyDbEnv.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runSelectedSource.mock.invocationCallOrder[0],
    );
    expect(mocks.initSentry.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runSelectedSource.mock.invocationCallOrder[0],
    );
    expect(mocks.flushSentry).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("reports a selected source failure and flushes telemetry before failing", async () => {
    const failure = new Error("Provider request failed");
    mocks.runSelectedSource.mockRejectedValueOnce(failure);
    const program = await createProgram();

    await program.parseAsync(["node", "crawl", "--source", "district-news"]);

    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining(failure.message),
      expect.objectContaining({ source: "district-news" }),
    );
    expect(mocks.flushSentry).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
