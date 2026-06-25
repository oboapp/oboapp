const DEFAULT_UNFILTERED_MESSAGES_LIMIT = 200;
export const DEFAULT_MAX_MESSAGES_LIMIT = 1000;

function parsePositiveIntEnv(
  envValue: string | undefined,
  fallback: number,
): number {
  if (!envValue) {
    return fallback;
  }

  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function getMaxMessagesLimit(): number {
  return parsePositiveIntEnv(
    process.env.PUBLIC_API_MESSAGES_MAX_LIMIT,
    DEFAULT_MAX_MESSAGES_LIMIT,
  );
}

export function getDefaultUnfilteredMessagesLimit(): number {
  return Math.min(
    parsePositiveIntEnv(
      process.env.PUBLIC_API_MESSAGES_DEFAULT_LIMIT,
      DEFAULT_UNFILTERED_MESSAGES_LIMIT,
    ),
    getMaxMessagesLimit(),
  );
}

export function clampMessagesLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return getMaxMessagesLimit();
  }

  return Math.min(limit, getMaxMessagesLimit());
}
