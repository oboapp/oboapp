export function toRequiredISOString(value: unknown, fieldName: string): string {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      throw new TypeError(`Invalid date for required field: ${fieldName}`);
    }
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(
        `Invalid date string for required field: ${fieldName}`,
      );
    }
    return value;
  }

  throw new Error(`Missing required date field: ${fieldName}`);
}

export function toOptionalISOString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return toRequiredISOString(value, fieldName);
}
