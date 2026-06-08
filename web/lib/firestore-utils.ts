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
