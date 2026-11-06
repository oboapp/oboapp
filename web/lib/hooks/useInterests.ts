"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Interest } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { fetchWithAuth } from "@/lib/auth-fetch";

const OFFLINE_ERROR = "Няма интернет връзка. Свържи се с интернет и опитай отново.";
const EMPTY_INTERESTS: Interest[] = [];

interface InterestsState {
  userId: string | null | undefined;
  interests: Interest[];
  isLoading: boolean;
  hasInitialized: boolean;
  error: string | null;
}

function getInterestLoadError(error: unknown): string {
  if (!navigator.onLine) {
    return OFFLINE_ERROR;
  }

  return error instanceof Error ? error.message : "Failed to load interests";
}

export function useInterests() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.uid ?? null;
  const [state, setState] = useState<InterestsState>({
    userId: undefined,
    interests: [],
    isLoading: false,
    hasInitialized: false,
    error: null,
  });
  const latestRequest = useRef(0);

  // Fetch interests for the current user
  // Wait for auth to settle before initializing to avoid flash
  const fetchInterests = useCallback(async () => {
    const request = ++latestRequest.current;

    // Don't initialize until auth state is determined
    if (authLoading) {
      return;
    }

    if (!user) {
      setState({
        userId: null,
        interests: [],
        isLoading: false,
        hasInitialized: true,
        error: null,
      });
      return;
    }

    try {
      setState((previous) => {
        const sameUser = previous.userId === user.uid;
        return {
          userId: user.uid,
          interests: sameUser ? previous.interests : [],
          hasInitialized: sameUser && previous.hasInitialized,
          isLoading: true,
          error: null,
        };
      });

      const response = await fetchWithAuth(user, "/api/interests");
      if (request !== latestRequest.current) {
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Failed to fetch interests:", response.status, errorData);
        throw new Error(
          `Failed to fetch interests: ${response.status} - ${
            errorData.error || "Unknown error"
          }`,
        );
      }

      const data = await response.json();
      if (request !== latestRequest.current) {
        return;
      }

      const fetchedInterests: Interest[] = Array.isArray(data.interests)
        ? data.interests
        : [];

      // Check for duplicates from API
      const ids = fetchedInterests.map((i: Interest) => i.id);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        console.error("[useInterests] API returned duplicate interests!", {
          total: ids.length,
          unique: uniqueIds.size,
        });
      }

      // Deduplicate by ID (defensive)
      const deduped = fetchedInterests.filter(
        (interest: Interest, index: number, self: Interest[]) =>
          index === self.findIndex((i) => i.id === interest.id),
      );

      if (deduped.length !== fetchedInterests.length) {
        console.warn(
          "[useInterests] Removed",
          fetchedInterests.length - deduped.length,
          "duplicate interests",
        );
      }

      setState((previous) => {
        return { ...previous, interests: deduped };
      });
    } catch (err) {
      if (request !== latestRequest.current) {
        return;
      }

      console.error("Error fetching interests:", err);
      setState((previous) => {
        return { ...previous, error: getInterestLoadError(err) };
      });
    } finally {
      if (request === latestRequest.current) {
        setState((previous) => {
          return { ...previous, isLoading: false, hasInitialized: true };
        });
      }
    }
  }, [user, authLoading]);

  // Add a new interest
  const addInterest = useCallback(
    async (
      coordinates: { lat: number; lng: number },
      radius: number = 500,
      metadata?: { label?: string; color?: string },
    ) => {
      if (!user) {
        throw new Error("Must be logged in to add interests");
      }

      try {
        const response = await fetchWithAuth(user, "/api/interests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ coordinates, radius, ...metadata }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error("[addInterest] Failed:", response.status, errorData);
          throw new Error(
            `Failed to add interest: ${response.status} - ${
              errorData.error || "Unknown error"
            }`,
          );
        }

        const data = await response.json();

        // Check if this interest already exists in the array (prevent duplicates)
        setState((previous) => {
          if (previous.userId !== user.uid) {
            return previous;
          }

          const exists = previous.interests.some((interest) => {
            return interest.id === data.interest.id;
          });
          if (exists) {
            return previous;
          }

          return { ...previous, interests: [data.interest, ...previous.interests] };
        });

        if (user.isAnonymous) {
          trackEvent({
            name: "guest_zone_created",
            params: { radius },
          });
        }

        return data.interest;
      } catch (err) {
        console.error("Error adding interest:", err);
        // Provide helpful error message for offline state
        if (!navigator.onLine) {
          throw new Error(OFFLINE_ERROR);
        }
        throw err;
      }
    },
    [user],
  );

  const updateInterest = useCallback(
    async (
      id: string,
      updates: {
        coordinates?: { lat: number; lng: number };
        radius?: number;
      },
    ) => {
      if (!user) {
        throw new Error("Must be logged in to update interests");
      }

      try {
        const response = await fetchWithAuth(user, "/api/interests", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id, ...updates }),
        });

        if (!response.ok) {
          throw new Error("Failed to update interest");
        }

        const data = await response.json();
        setState((previous) => {
          if (previous.userId !== user.uid) {
            return previous;
          }

          return {
            ...previous,
            interests: previous.interests.map((interest) => {
              return interest.id === id ? data.interest : interest;
            }),
          };
        });
        return data.interest;
      } catch (err) {
        console.error("Error updating interest:", err);
        // Provide helpful error message for offline state
        if (!navigator.onLine) {
          throw new Error(OFFLINE_ERROR);
        }
        throw err;
      }
    },
    [user],
  );

  // Delete an interest
  const deleteInterest = useCallback(
    async (id: string) => {
      if (!user) {
        throw new Error("Must be logged in to delete interests");
      }

      try {
        const response = await fetchWithAuth(user, `/api/interests?id=${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error("[deleteInterest] Failed:", response.status, errorData);
          throw new Error(
            `Failed to delete interest: ${response.status} - ${
              errorData.error || "Unknown error"
            }`,
          );
        }

        setState((previous) => {
          if (previous.userId !== user.uid) {
            return previous;
          }

          return {
            ...previous,
            interests: previous.interests.filter((interest) => {
              return interest.id !== id;
            }),
          };
        });
      } catch (err) {
        console.error("Error deleting interest:", err);
        // Provide helpful error message for offline state
        if (!navigator.onLine) {
          throw new Error(OFFLINE_ERROR);
        }
        throw err;
      }
    },
    [user],
  );

  // Fetch interests when user logs in
  useEffect(() => {
    void fetchInterests();
    return () => {
      latestRequest.current += 1;
    };
  }, [fetchInterests]);

  const isCurrentUser = !authLoading && state.userId === userId;

  return {
    interests: isCurrentUser ? state.interests : EMPTY_INTERESTS,
    isLoading: authLoading || !isCurrentUser || state.isLoading,
    hasInitialized: isCurrentUser && state.hasInitialized,
    error: isCurrentUser ? state.error : null,
    addInterest,
    updateInterest,
    deleteInterest,
    refreshInterests: fetchInterests,
  };
}
