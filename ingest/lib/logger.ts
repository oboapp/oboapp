import { sanitizeDiagnosticText, serializeError } from "./error-diagnostics";

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

export function getCloudRunContext(): Record<string, string> {
  const context: Record<string, string> = {};
  const fields = {
    cloudRunJob: "CLOUD_RUN_JOB",
    cloudRunExecution: "CLOUD_RUN_EXECUTION",
    cloudRunTaskIndex: "CLOUD_RUN_TASK_INDEX",
    cloudRunTaskAttempt: "CLOUD_RUN_TASK_ATTEMPT",
  };
  for (const [key, variable] of Object.entries(fields)) {
    const value = process.env[variable];
    if (value) {
      context[key] = value;
    }
  }
  return context;
}

function serializeLogEntry(entry: LogEntry): LogEntry {
  const serialized: LogEntry = {
    ...entry,
    message: sanitizeDiagnosticText(entry.message),
  };
  for (const [key, value] of Object.entries(entry)) {
    if (key === "error" || value instanceof Error) {
      serialized[key] = serializeError(value);
    } else if (typeof value === "string") {
      serialized[key] = sanitizeDiagnosticText(value);
    }
  }
  return serialized;
}

function write(entry: LogEntry) {
  const serialized = serializeLogEntry(entry);
  if (!isProduction) {
    // Locally: use console for colored, readable output
    let fn = console.log;
    if (entry.severity === "ERROR") {
      fn = console.error;
    } else if (entry.severity === "WARNING") {
      fn = console.warn;
    }
    const { severity: _, message, ...extra } = serialized;
    if (Object.keys(extra).length > 0) {
      fn(message, extra);
    } else {
      fn(message);
    }
    return;
  }

  // Cloud Run: output single-line JSON that Cloud Logging auto-parses
  process.stdout.write(JSON.stringify(serialized) + "\n");
}

export const logger = {
  debug(message: string, extra?: Record<string, unknown>) {
    if (showDebug) {
      write({ severity: "DEBUG", message, ...extra, ...getCloudRunContext() });
    }
  },
  info(message: string, extra?: Record<string, unknown>) {
    write({ severity: "INFO", message, ...extra, ...getCloudRunContext() });
  },
  warn(message: string, extra?: Record<string, unknown>) {
    write({ severity: "WARNING", message, ...extra, ...getCloudRunContext() });
  },
  error(message: string, extra?: Record<string, unknown>) {
    const context = getCloudRunContext();
    write({ severity: "ERROR", message, ...extra, ...context });
    try {
      const metadata =
        Object.keys(context).length > 0 ? { ...extra, ...context } : extra;
      errorReporter?.(message, metadata);
    } catch {
      // Reporter failures must never crash the process or mask the original error
    }
  },
};
