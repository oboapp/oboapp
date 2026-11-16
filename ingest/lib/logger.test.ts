import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.CLOUD_RUN_JOB;
    delete process.env.CLOUD_RUN_EXECUTION;
    delete process.env.CLOUD_RUN_TASK_INDEX;
    delete process.env.CLOUD_RUN_TASK_ATTEMPT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function importLogger() {
    const mod = await import("./logger");
    return mod.logger;
  }

  describe("debug level", () => {
    it("should suppress debug messages by default locally", async () => {
      process.env.NODE_ENV = "test";
      delete process.env.LOG_LEVEL;
      const logger = await importLogger();
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.debug("hidden message");

      expect(spy).not.toHaveBeenCalled();
    });

    it("should show debug messages when LOG_LEVEL=debug", async () => {
      process.env.NODE_ENV = "test";
      process.env.LOG_LEVEL = "debug";
      vi.resetModules();
      const logger = await importLogger();
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.debug("visible message");

      expect(spy).toHaveBeenCalledWith("visible message");
    });

    it("should pass extra metadata in debug messages", async () => {
      process.env.NODE_ENV = "test";
      process.env.LOG_LEVEL = "debug";
      vi.resetModules();
      const logger = await importLogger();
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.debug("msg", { key: "value" });

      expect(spy).toHaveBeenCalledWith("msg", { key: "value" });
    });
  });

  describe("setErrorReporter", () => {
    it("preserves the original exception for the reporter", async () => {
      process.env.NODE_ENV = "production";
      const { logger, setErrorReporter } = await import("./logger");
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const reporter = vi.fn();
      const error = new TypeError("fetch failed", {
        cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      });
      setErrorReporter(reporter);

      logger.error("Source failed", { error });

      expect(reporter.mock.calls[0][1].error).toBe(error);
    });

    it("keeps reporter failures from escaping", async () => {
      process.env.NODE_ENV = "test";
      const { logger, setErrorReporter } = await import("./logger");
      vi.spyOn(console, "error").mockImplementation(() => {});
      setErrorReporter(() => {
        throw new Error("reporter failed");
      });

      expect(() => {
        logger.error("Original failure");
      }).not.toThrow();
    });

    it("should invoke the reporter on error() with message and extra", async () => {
      process.env.NODE_ENV = "test";
      const { logger, setErrorReporter } = await import("./logger");
      vi.spyOn(console, "error").mockImplementation(() => {});
      const reporter = vi.fn();
      setErrorReporter(reporter);

      logger.error("boom", { step: "test" });

      expect(reporter).toHaveBeenCalledWith("boom", { step: "test" });
    });

    it("should not invoke the reporter for info, warn, or debug", async () => {
      process.env.NODE_ENV = "test";
      process.env.LOG_LEVEL = "debug";
      vi.resetModules();
      const { logger, setErrorReporter } = await import("./logger");
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const reporter = vi.fn();
      setErrorReporter(reporter);

      logger.info("info");
      logger.warn("warn");
      logger.debug("debug");

      expect(reporter).not.toHaveBeenCalled();
    });
  });

  describe("production diagnostics", () => {
    it("writes useful nested network causes as JSON", async () => {
      process.env.NODE_ENV = "production";
      const logger = await importLogger();
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const cause = Object.assign(new Error("getaddrinfo ENOTFOUND provider.example"), {
        code: "ENOTFOUND",
        errno: -3008,
        syscall: "getaddrinfo",
        authorization: "private-token",
      });
      const error = new TypeError("fetch failed", { cause });

      logger.error("Source failed", { sourceType: "lozenets-sofia-bg", error });

      const entry = JSON.parse(String(write.mock.calls[0][0]));
      expect(entry).toMatchObject({
        severity: "ERROR",
        sourceType: "lozenets-sofia-bg",
        error: {
          name: "TypeError",
          message: "fetch failed",
          stack: error.stack,
          cause: {
            message: "getaddrinfo ENOTFOUND provider.example",
            code: "ENOTFOUND",
            errno: -3008,
            syscall: "getaddrinfo",
          },
        },
      });
      expect(entry.error.cause).not.toHaveProperty("authorization");
    });

    it("logs cyclic aggregate errors without failing", async () => {
      process.env.NODE_ENV = "production";
      const logger = await importLogger();
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const cause = new Error("connect timeout");
      cause.cause = cause;
      const error = new AggregateError([cause], "all connections failed");

      logger.error("Source failed", { error });

      const entry = JSON.parse(String(write.mock.calls[0][0]));
      expect(entry.error.errors[0]).toMatchObject({
        message: "connect timeout",
        cause: "[circular error]",
      });
    });

    it("redacts credentials and private URL parameters in error messages and stacks", async () => {
      process.env.NODE_ENV = "production";
      const logger = await importLogger();
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const url = "https://user:secret@provider.example/feed?token=private#person";

      logger.error(`Source failed for ${url}`, {
        feedUrl: url,
        error: new Error(`Fetch failed for ${url}`),
      });

      const output = String(write.mock.calls[0][0]);
      expect(output).toContain("https://provider.example/feed");
      for (const value of ["user", "secret", "token=", "private", "#person"]) {
        expect(output).not.toContain(value);
      }
    });

    it("retains safe diagnostics for non-Error throws", async () => {
      process.env.NODE_ENV = "production";
      const logger = await importLogger();
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      logger.error("Source failed", {
        error: { message: "fetch failed", code: "ECONNRESET", password: "private" },
      });

      const entry = JSON.parse(String(write.mock.calls[0][0]));
      expect(entry.error).toEqual({ message: "fetch failed", code: "ECONNRESET" });
    });

    it("correlates failure and later completion using Cloud Run execution metadata", async () => {
      process.env.NODE_ENV = "production";
      const { logger, setErrorReporter } = await import("./logger");
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const reporter = vi.fn();
      setErrorReporter(reporter);
      process.env.CLOUD_RUN_JOB = "crawl-lozenets";
      process.env.CLOUD_RUN_EXECUTION = "crawl-lozenets-test";
      process.env.CLOUD_RUN_TASK_INDEX = "0";
      process.env.CLOUD_RUN_TASK_ATTEMPT = "0";

      logger.error("Source failed", { error: new Error("fetch failed") });
      process.env.CLOUD_RUN_TASK_ATTEMPT = "1";
      logger.info("Crawl complete", { saved: 0, failed: 0 });

      const failure = JSON.parse(String(write.mock.calls[0][0]));
      const completion = JSON.parse(String(write.mock.calls[1][0]));
      expect(failure).toMatchObject({
        cloudRunJob: "crawl-lozenets",
        cloudRunExecution: "crawl-lozenets-test",
        cloudRunTaskIndex: "0",
        cloudRunTaskAttempt: "0",
      });
      expect(completion).toMatchObject({
        cloudRunExecution: failure.cloudRunExecution,
        cloudRunTaskAttempt: "1",
        failed: 0,
      });
      expect(reporter.mock.calls[0][1]).toMatchObject({
        cloudRunExecution: failure.cloudRunExecution,
        cloudRunTaskAttempt: "0",
      });
    });

    it("omits unavailable Cloud Run metadata", async () => {
      process.env.NODE_ENV = "production";
      const logger = await importLogger();
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      logger.info("Crawl complete");

      expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual({
        severity: "INFO",
        message: "Crawl complete",
      });
    });
  });

  describe("info, warn, error remain unchanged", () => {
    it("should log info messages", async () => {
      process.env.NODE_ENV = "test";
      const logger = await importLogger();
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.info("info msg");

      expect(spy).toHaveBeenCalledWith("info msg");
    });

    it("should log warn messages", async () => {
      process.env.NODE_ENV = "test";
      const logger = await importLogger();
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logger.warn("warn msg");

      expect(spy).toHaveBeenCalledWith("warn msg");
    });

    it("should log error messages", async () => {
      process.env.NODE_ENV = "test";
      const logger = await importLogger();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.error("error msg");

      expect(spy).toHaveBeenCalledWith("error msg");
    });
  });
});
