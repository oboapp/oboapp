// @vitest-environment node

import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  program: undefined as Command | undefined,
  configureEnv: vi.fn(),
  verifyDbEnv: vi.fn(),
  verifyEnvSet: vi.fn(),
  initSentry: vi.fn(),
  flushSentry: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  getSelectedSourceIds: vi.fn(),
  getEmergentSourceIds: vi.fn(),
  runSelectedSource: vi.fn(),
  ingest: vi.fn(),
  notify: vi.fn(),
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
vi.mock("@/lib/verify-env", () => ({
  verifyDbEnv: mocks.verifyDbEnv,
  verifyEnvSet: mocks.verifyEnvSet,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, error: mocks.error } }));
vi.mock("@/lib/sentry", () => ({ initSentry: mocks.initSentry, flushSentry: mocks.flushSentry }));
vi.mock("@/sources/registry", () => ({
  getSelectedSourceIds: mocks.getSelectedSourceIds,
  getEmergentSourceIds: mocks.getEmergentSourceIds,
  runSelectedSource: mocks.runSelectedSource,
}));
vi.mock("./messageIngest/from-sources", () => ({ ingest: mocks.ingest }));
vi.mock("./notifications/match-and-notify", () => ({ main: mocks.notify }));

async function createProgram(): Promise<Command> {
  await import("./pipeline");
  const program = mocks.program;
  if (!program) {
    throw new Error("The pipeline command was not created");
  }
  program.configureOutput({ writeOut: mocks.writeOut, writeErr: mocks.writeErr });
  program.exitOverride();
  return program;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.program = undefined;
  mocks.getSelectedSourceIds.mockReturnValue(["district-news", "water-alerts", "road-alerts"]);
  mocks.getEmergentSourceIds.mockReturnValue(["water-alerts", "road-alerts"]);
  mocks.runSelectedSource.mockResolvedValue(undefined);
  mocks.ingest.mockResolvedValue(undefined);
  mocks.notify.mockResolvedValue(undefined);
  mocks.flushSentry.mockResolvedValue(undefined);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selected-source pipeline command", () => {
  it("shows only selected source groups in help without loading environment or runtimes", async () => {
    const program = await createProgram();

    await expect(program.parseAsync(["node", "pipeline", "--help"])).rejects.toMatchObject({
      code: "commander.helpDisplayed",
    });

    const output = mocks.writeOut.mock.calls.map(([text]) => text).join("");
    expect(output).toContain("district-news");
    expect(output).toContain("water-alerts");
    expect(output).toContain("road-alerts");
    expect(output).not.toContain("sensor-community");
    expect(mocks.configureEnv).not.toHaveBeenCalled();
    expect(mocks.verifyDbEnv).not.toHaveBeenCalled();
    expect(mocks.runSelectedSource).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("runs every selected source in catalog order for --all before ingestion and notifications", async () => {
    const program = await createProgram();

    await program.parseAsync(["node", "pipeline", "--all"]);

    expect(mocks.runSelectedSource.mock.calls).toEqual([
      ["district-news"],
      ["water-alerts"],
      ["road-alerts"],
    ]);
    expect(mocks.configureEnv.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyDbEnv.mock.invocationCallOrder[0],
    );
    expect(mocks.verifyDbEnv.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runSelectedSource.mock.invocationCallOrder[0],
    );
    expect(mocks.verifyEnvSet.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runSelectedSource.mock.invocationCallOrder[0],
    );
    expect(mocks.runSelectedSource.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.ingest.mock.invocationCallOrder[0],
    );
    expect(mocks.ingest.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.notify.mock.invocationCallOrder[0],
    );
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("runs only selected emergent sources for --emergent", async () => {
    const program = await createProgram();

    await program.parseAsync(["node", "pipeline", "--emergent"]);

    expect(mocks.runSelectedSource.mock.calls).toEqual([["water-alerts"], ["road-alerts"]]);
    expect(mocks.ingest).toHaveBeenCalledExactlyOnceWith({});
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("continues selected sources, ingestion and notifications after a source failure", async () => {
    mocks.runSelectedSource.mockRejectedValueOnce(new Error("District provider unavailable"));
    const program = await createProgram();

    await program.parseAsync(["node", "pipeline", "--all"]);

    expect(mocks.runSelectedSource.mock.calls).toEqual([
      ["district-news"],
      ["water-alerts"],
      ["road-alerts"],
    ]);
    expect(mocks.ingest).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("1 crawler failure"),
      expect.objectContaining({ failedCrawlers: ["district-news"] }),
    );
    expect(mocks.flushSentry).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
