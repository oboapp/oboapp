"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { fetchWithAuth } from "@/lib/auth-fetch";

interface NotificationFiltersState {
  notificationCategories: string[];
  notificationSources: string[];
  experimentalFeatures: boolean;
}

const EMPTY_FILTERS: NotificationFiltersState = {
  notificationCategories: [],
  notificationSources: [],
  experimentalFeatures: false,
};

export function useNotificationFilters() {
  const { user } = useAuth();
  const [savedFilters, setSavedFilters] =
    useState<NotificationFiltersState>(EMPTY_FILTERS);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(),
  );
  const [experimentalFeatures, setExperimentalFeatures] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current filters on mount
  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      setSavedFilters(EMPTY_FILTERS);
      setSelectedCategories(new Set());
      setSelectedSources(new Set());
      setExperimentalFeatures(false);
      return;
    }

    let cancelled = false;
    const currentUser = user;

    async function fetchFilters() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetchWithAuth(
          currentUser,
          "/api/notifications/filters",
        );
        if (!res.ok) throw new Error("Failed to fetch filters");
        const data: NotificationFiltersState = await res.json();
        if (cancelled) return;
        setSavedFilters(data);
        setSelectedCategories(new Set(data.notificationCategories));
        setSelectedSources(new Set(data.notificationSources));
        setExperimentalFeatures(data.experimentalFeatures ?? false);
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching notification filters:", err);
        setError("Грешка при зареждане на филтрите");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchFilters();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const toggleSource = useCallback((source: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }, []);

  const selectAllCategories = useCallback((allCategories: string[]) => {
    setSelectedCategories(new Set(allCategories));
  }, []);

  const deselectAllCategories = useCallback(() => {
    setSelectedCategories(new Set());
  }, []);

  const selectAllSources = useCallback((allSources: string[]) => {
    setSelectedSources(new Set(allSources));
  }, []);

  const deselectAllSources = useCallback(() => {
    setSelectedSources(new Set());
  }, []);

  const isDirty = useMemo(() => {
    const savedCats = new Set(savedFilters.notificationCategories);
    const savedSrcs = new Set(savedFilters.notificationSources);

    if (selectedCategories.size !== savedCats.size) return true;
    if (selectedSources.size !== savedSrcs.size) return true;
    if (experimentalFeatures !== (savedFilters.experimentalFeatures ?? false))
      return true;

    for (const cat of selectedCategories) {
      if (!savedCats.has(cat)) return true;
    }
    for (const src of selectedSources) {
      if (!savedSrcs.has(src)) return true;
    }

    return false;
  }, [savedFilters, selectedCategories, selectedSources, experimentalFeatures]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!user) return false;

    try {
      setIsSaving(true);
      setError(null);

      const body = {
        notificationCategories: [...selectedCategories],
        notificationSources: [...selectedSources],
        experimentalFeatures,
      };

      const res = await fetchWithAuth(user, "/api/notifications/filters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to save filters");

      const data: NotificationFiltersState = await res.json();
      setSavedFilters(data);
      setSelectedCategories(new Set(data.notificationCategories));
      setSelectedSources(new Set(data.notificationSources));
      setExperimentalFeatures(data.experimentalFeatures ?? false);
      return true;
    } catch (err) {
      console.error("Error saving notification filters:", err);
      setError("Грешка при запазване на филтрите");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [user, selectedCategories, selectedSources, experimentalFeatures]);

  const clearAll = useCallback(() => {
    setSelectedCategories(new Set());
    setSelectedSources(new Set());
    setExperimentalFeatures(false);
  }, []);

  const resetToSaved = useCallback(() => {
    setSelectedCategories(new Set(savedFilters.notificationCategories));
    setSelectedSources(new Set(savedFilters.notificationSources));
    setExperimentalFeatures(savedFilters.experimentalFeatures ?? false);
  }, [savedFilters]);

  return {
    selectedCategories,
    selectedSources,
    experimentalFeatures,
    setExperimentalFeatures,
    isLoading,
    isSaving,
    error,
    isDirty,
    toggleCategory,
    toggleSource,
    selectAllCategories,
    deselectAllCategories,
    selectAllSources,
    deselectAllSources,
    save,
    clearAll,
    resetToSaved,
  };
}
