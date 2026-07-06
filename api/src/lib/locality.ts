export const LOCALITY_ENV_ERROR_MESSAGE =
  "LOCALITY environment variable is required but not set";

export function getRequiredLocality(): string {
  const locality = process.env.LOCALITY?.trim();
  if (!locality) {
    throw new Error(LOCALITY_ENV_ERROR_MESSAGE);
  }
  return locality;
}