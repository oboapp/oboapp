import sources from "@/lib/sources.json";
import { isExperimentalSource } from "@oboapp/shared";

export interface Source {
  id: string;
  url: string;
  name: string;
  localities: string[];
}

/**
 * Get sources applicable to a specific locality
 * @param locality - The locality ID (e.g., "bg.sofia")
 * @returns Array of sources that serve this locality
 */
export function getSourcesForLocality(locality: string): Source[] {
  const filtered: Source[] = sources.filter((source) =>
    source.localities.includes(locality),
  );
  return filtered;
}

/**
 * Get sources applicable to the current locality from environment
 * @returns Array of sources for the current NEXT_PUBLIC_LOCALITY
 * @throws Error if NEXT_PUBLIC_LOCALITY is not set
 */
export function getCurrentLocalitySources(): Source[] {
  const locality = process.env.NEXT_PUBLIC_LOCALITY;
  if (!locality) {
    throw new Error(
      "NEXT_PUBLIC_LOCALITY environment variable is required but not set",
    );
  }
  return getSourcesForLocality(locality);
}

/**
 * Get experimental sources for the current locality.
 * Returns sources that are marked as experimental in the shared config.
 */
export function getExperimentalSources(): Source[] {
  try {
    const allSources = getCurrentLocalitySources();
    return allSources.filter((s) => isExperimentalSource(s.id));
  } catch {
    return [];
  }
}
