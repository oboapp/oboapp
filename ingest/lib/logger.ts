/**
 * Structured JSON logger for Google Cloud Logging.
 *
 * On Cloud Run, stdout JSON with a "severity" field is automatically parsed
 * by Cloud Logging, making logs filterable and alertable.
 *
 * Locally, falls back to plain console output for readability.
 *
 * Levels:
 *   - **debug** – per-item / operational step details (hidden locally by default,
 *     set `LOG_LEVEL=debug` to show). Always emitted in production for Cloud Logging.
 *   - **info**  – high-level milestones and summaries.
 *   - **warn**  – recoverable issues.
 *   - **error** – failures that need attention.
 */

type ErrorReporter = (message: string, extra?: Record<string, unknown>) => void;
let errorReporter: ErrorReporter | null = null;

/** Register a callback to be invoked for every error-level log entry. */
export function setErrorReporter(reporter: ErrorReporter): void {
  errorReporter = reporter;
}

const isProduction = process.env.NODE_ENV === "production";
const showDebug =
  isProduction || process.env.LOG_LEVEL?.toLowerCase() === "debug";

interface LogEntry {
  severity: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  message: string;
  [key: string]: unknown;
}

function write(entry: LogEntry) {
  if (!isProduction) {
    // Locally: use console for colored, readable output
    const fn =
      entry.severity === "ERROR"
        ? console.error
        : entry.severity === "WARNING"
          ? console.warn
          : console.log;
    const { severity: _, message, ...extra } = entry;
    if (Object.keys(extra).length > 0) {
      fn(message, extra);
    } else {
      fn(message);
    }
    return;
  }

  // Cloud Run: output single-line JSON that Cloud Logging auto-parses
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug(message: string, extra?: Record<string, unknown>) {
    if (showDebug) {
      write({ severity: "DEBUG", message, ...extra });
    }
  },
  info(message: string, extra?: Record<string, unknown>) {
    write({ severity: "INFO", message, ...extra });
  },
  warn(message: string, extra?: Record<string, unknown>) {
    write({ severity: "WARNING", message, ...extra });
  },
  error(message: string, extra?: Record<string, unknown>) {
    write({ severity: "ERROR", message, ...extra });
    try {
      errorReporter?.(message, extra);
    } catch {
      // Reporter failures must never crash the process or mask the original error
    }
  },
};
