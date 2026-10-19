/** Conditional writes deliberately support plain top-level fields only. */
export function validateConditionalUpdate(
  tokenField: string,
  expectedToken: string,
  data: Record<string, unknown>,
): void {
  const validField = (field: string) =>
    /^[A-Za-z_]\w*$/.test(field) && field !== "_id";
  if (!validField(tokenField) || typeof expectedToken !== "string") {
    throw new TypeError("Conditional updates require a top-level field and string token");
  }
  const entries = Object.entries(data);
  if (entries.length === 0 || entries.some(([key, value]) => !validField(key) || value === undefined)) {
    throw new TypeError("Conditional updates require defined plain top-level fields");
  }
}
