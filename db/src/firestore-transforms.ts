/**
 * Firestore-specific data transforms.
 *
 * Handles the impedance mismatch between application-level native types
 * and Firestore's storage format:
 * - geoJson, addresses stored as JSON strings in Firestore → native objects
 * - Firestore Timestamp → Date
 * - Date → preserved as-is (Firestore accepts Date, stores as Timestamp)
 */

/** Fields that Firestore stores as JSON strings (per collection) */
const STRINGIFY_ON_WRITE: Record<string, Set<string>> = {
  messages: new Set(["geoJson", "addresses"]),
  events: new Set(["geoJson"]),
};

/** Fields that may be JSON strings when reading from Firestore (per collection) */
const PARSE_ON_READ: Record<string, Set<string>> = {
  messages: new Set(["geoJson", "addresses", "ingestErrors"]),
  events: new Set(["geoJson"]),
};

function hasToDate(v: object): v is { toDate(): Date } {
  return "toDate" in v && typeof v.toDate === "function";
}

function hasSeconds(v: object): v is { _seconds: number } {
  return "_seconds" in v && typeof v._seconds === "number";
}

function isFirestoreTimestamp(
  value: unknown,
): value is { toDate(): Date } | { _seconds: number } {
  if (!value || typeof value !== "object") return false;
  return hasToDate(value) || hasSeconds(value);
}

function timestampToDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null) {
    if (hasToDate(value)) {
      return value.toDate();
    }
    if (hasSeconds(value)) {
      return new Date(value._seconds * 1000);
    }
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) return new Date(parsed);
  }
  return new Date();
}

/**
 * Transform data for writing to Firestore.
 * - Stringifies known object fields (geoJson, addresses) to JSON strings
 * - Skips undefined values
 * - Preserves everything else as-is
 */
export function transformForFirestoreWrite(
  collection: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const stringifySet = STRINGIFY_ON_WRITE[collection];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;

    if (stringifySet?.has(key) && value !== null && typeof value === "object") {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Transform data read from Firestore to native types.
 * - Converts Firestore Timestamps to Date objects
 * - Parses JSON string fields to native objects
 * - Preserves everything else
 */
export function transformFromFirestoreRead(
  collection: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const parseSet = PARSE_ON_READ[collection];

  for (const [key, value] of Object.entries(data)) {
    if (isFirestoreTimestamp(value)) {
      result[key] = timestampToDate(value);
    } else if (parseSet?.has(key) && typeof value === "string") {
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}
