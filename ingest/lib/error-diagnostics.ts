const MAX_ERROR_DEPTH = 6;
const MAX_AGGREGATE_ERRORS = 10;
const MAX_ERROR_NODES = 30;
const MAX_DIAGNOSTIC_LENGTH = 8_192;
const NETWORK_FIELDS = ["code", "errno", "syscall"];

/** Keep provider paths useful while removing URL credentials and private parameters. */
export function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try {
        const suffix = value.endsWith(")") ? ")" : "";
        const url = new URL(suffix ? value.slice(0, -1) : value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString() + suffix;
      } catch {
        return "[redacted URL]";
      }
    })
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function readField(value: object, field: string): unknown {
  try {
    return Reflect.get(value, field);
  } catch {
    return undefined;
  }
}

function serializeDiagnostic(
  value: unknown,
  seen: Set<object>,
  depth: number,
  budget: { remaining: number },
): unknown {
  if (typeof value === "string") {
    return sanitizeDiagnosticText(value);
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (seen.has(value)) {
    return "[circular error]";
  }
  if (depth >= MAX_ERROR_DEPTH || budget.remaining <= 0) {
    return "[error depth limit]";
  }
  budget.remaining--;
  seen.add(value);

  const diagnostic: Record<string, unknown> = {};
  for (const field of ["name", "message", "stack", ...NETWORK_FIELDS]) {
    const fieldValue = readField(value, field);
    if (typeof fieldValue === "string") {
      diagnostic[field] = sanitizeDiagnosticText(fieldValue);
    } else if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) {
      diagnostic[field] = fieldValue;
    }
  }
  const cause = readField(value, "cause");
  if (cause !== undefined) {
    diagnostic.cause = serializeDiagnostic(cause, seen, depth + 1, budget);
  }
  const errors = readField(value, "errors");
  if (Array.isArray(errors)) {
    diagnostic.errors = errors.slice(0, MAX_AGGREGATE_ERRORS).map((error) => {
      return serializeDiagnostic(error, seen, depth + 1, budget);
    });
  }
  seen.delete(value);
  return diagnostic;
}

/** Include only actionable error fields, with bounded cause traversal. */
export function serializeError(error: unknown): unknown {
  return serializeDiagnostic(error, new Set<object>(), 0, {
    remaining: MAX_ERROR_NODES,
  });
}

function restoreError(diagnostic: unknown): unknown {
  if (diagnostic === null || typeof diagnostic !== "object") {
    return diagnostic;
  }
  const message = readField(diagnostic, "message");
  const errorMessage = typeof message === "string" ? message : "Error";
  const errors = readField(diagnostic, "errors");
  let error: Error;
  if (Array.isArray(errors)) {
    const nestedErrors = errors.map((nested) => {
      return restoreError(nested);
    });
    error = new AggregateError(nestedErrors, errorMessage);
  } else {
    error = new Error(errorMessage);
  }
  for (const field of ["name", "stack", ...NETWORK_FIELDS]) {
    const value = readField(diagnostic, field);
    if (value !== undefined) {
      Object.defineProperty(error, field, { value, configurable: true });
    }
  }
  const cause = readField(diagnostic, "cause");
  if (cause !== undefined) {
    error.cause = restoreError(cause);
  }
  return error;
}

/** Preserve exception stacks and causes without forwarding arbitrary error properties. */
export function sanitizeError(error: Error): Error {
  const sanitized = restoreError(serializeError(error));
  return sanitized instanceof Error ? sanitized : new Error("Error");
}
