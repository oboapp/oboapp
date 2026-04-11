import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
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
