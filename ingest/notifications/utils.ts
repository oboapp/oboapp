/**
 * Convert Firestore timestamp to ISO string
 */

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function convertTimestamp(timestamp: unknown): string {
  if (timestamp && isRecordLike(timestamp)) {
    // Check for Firestore internal format (_seconds)
    if ("_seconds" in timestamp && typeof timestamp._seconds === "number") {
      return new Date(timestamp._seconds * 1000).toISOString();
    }

    // Check for Firestore Timestamp object (toDate method)
    if ("toDate" in timestamp && typeof timestamp.toDate === "function") {
      const result: unknown = timestamp.toDate();
      if (result instanceof Date) {
        return result.toISOString();
      }
    }
  }

  if (typeof timestamp === "string") {
    return timestamp;
  }

  return new Date().toISOString();
}
