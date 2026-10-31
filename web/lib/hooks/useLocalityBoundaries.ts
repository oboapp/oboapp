"use client";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

const BOUNDARY_CACHE_TIME_MS = 24 * 60 * 60 * 1000;
const BOUNDARY_ERROR_MESSAGE =
  "Не успях да заредя границите на града. Част от събитията може да липсват. Презареди страницата.";

interface LocalityBoundaryResult {
  locality: string;
  boundary: unknown;
}

interface LocalityBoundariesState {
  boundaries: Readonly<Record<string, unknown>>;
  isLoading: boolean;
  error: string | null;
}

async function fetchLocalityBoundary(
  locality: string,
  signal: AbortSignal,
): Promise<LocalityBoundaryResult> {
  const response = await fetch(
    `/api/localities/${encodeURIComponent(locality)}/boundary`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(BOUNDARY_ERROR_MESSAGE);
  }

  const boundary: unknown = await response.json();
  if (
    boundary === null ||
    typeof boundary !== "object" ||
    !("type" in boundary) ||
    boundary.type !== "FeatureCollection" ||
    !("features" in boundary) ||
    !Array.isArray(boundary.features)
  ) {
    throw new Error(BOUNDARY_ERROR_MESSAGE);
  }

  return { locality, boundary };
}

function combineBoundaries(
  results: UseQueryResult<LocalityBoundaryResult>[],
): LocalityBoundariesState {
  const boundaries: Record<string, unknown> = {};

  for (const result of results) {
    if (result.data) {
      boundaries[result.data.locality] = result.data.boundary;
    }
  }

  return {
    boundaries,
    isLoading: results.some((result) => result.isLoading),
    error: results.some((result) => result.isError)
      ? BOUNDARY_ERROR_MESSAGE
      : null,
  };
}

export function useLocalityBoundaries(
  localities: readonly string[],
): LocalityBoundariesState {
  const requestedLocalities = Array.from(new Set(localities)).sort();

  return useQueries({
    queries: requestedLocalities.map((locality) => ({
      queryKey: ["locality-boundary", locality],
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        return fetchLocalityBoundary(locality, signal);
      },
      staleTime: BOUNDARY_CACHE_TIME_MS,
      gcTime: BOUNDARY_CACHE_TIME_MS,
      retry: 1,
    })),
    combine: combineBoundaries,
  });
}
