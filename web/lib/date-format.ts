/**
 * Format an ISO date string as DD.MM.YYYY using Bulgarian locale.
 */
export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Format an ISO date string as DD.MM.YYYY, HH:mm using Bulgarian locale.
 */
export function formatDateTime(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a start–end date range as a human-readable string.
 */
export function formatTimespan(
  start: string | undefined,
  end: string | undefined,
): string {
  const startStr = formatDate(start);
  const endStr = formatDate(end);
  if (startStr && endStr && startStr !== endStr)
    return `${startStr} – ${endStr}`;
  if (startStr) return startStr;
  if (endStr) return endStr;
  return "";
}
