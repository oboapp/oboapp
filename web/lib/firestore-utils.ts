/**
 * Shared Firestore utility functions
 */

export type FirestoreValue =
  | {
      _seconds: number;
      _nanoseconds: number;
      toDate(): Date;
    }
  | Date
  | string;

export function convertTimestamp(timestamp: unknown): string {
  if (!timestamp) {
    return new Date().toISOString();
  }

  // Handle Firestore Timestamp with _seconds property
  if (
    typeof timestamp === "object" &&
    timestamp !== null &&
    "_seconds" in timestamp &&
    typeof timestamp._seconds === "number"
  ) {
    return new Date(timestamp._seconds * 1000).toISOString();
  }

  // Handle objects with toDate method
  if (
    typeof timestamp === "object" &&
    timestamp !== null &&
    "toDate" in timestamp &&
    typeof timestamp.toDate === "function"
  ) {
    const dateResult: unknown = timestamp.toDate();
    if (dateResult instanceof Date) {
      return dateResult.toISOString();
    }
  }

  // Handle Date objects
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }

  // Handle string timestamps
  if (typeof timestamp === "string") {
    return timestamp;
  }

  // Fallback
  return new Date().toISOString();
}

/**
 * Safely parse JSON string with fallback to default value
 * Logs parse failures to help track data quality issues
 *
 * For non-string inputs (e.g., from Firestore), returns the value as-is.
 *
 * ⚠️ Type T is not guaranteed at runtime - developer must ensure correctness.
 *
 * @param value - Value to parse (string, or already-deserialized value)
 * @param fallback - Value to return if parsing fails (default: undefined)
 * @param context - Optional context for logging (e.g., field name)
 * @returns Parsed value or fallback
 */
export const safeJsonParse: <T>(
  value: unknown,
  fallback?: T,
  context?: string,
) => T | undefined = safeJsonParseImpl;

function safeJsonParseImpl(
  value: unknown,
  fallback?: unknown,
  context?: string,
  // Return type is intentionally untyped — the public generic signature above
  // provides the type constraint. This avoids needing `as T` assertions.
): ReturnType<typeof JSON.parse> {
  // Non-string inputs are returned as-is (e.g., Firestore already-deserialized data)
  if (typeof value !== "string") {
    return value;
  }

  // Attempt to parse string — JSON.parse returns `any`
  try {
    return JSON.parse(value);
  } catch (error) {
    const contextMsg = context ? ` (${context})` : "";
    console.warn(`Failed to parse JSON${contextMsg}:`, error);
    return fallback;
  }
}
