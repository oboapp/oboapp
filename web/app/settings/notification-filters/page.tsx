"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useNotificationFilters } from "@/lib/hooks/useNotificationFilters";
import { getCurrentLocalitySources, getExperimentalSources } from "@/lib/source-utils";
import CategoryFilterItem from "@/components/CategoryFilterItem";
import SourceFilterItem from "@/components/SourceFilterItem";
import FilterSection from "@/components/FilterSection";
import {
  CATEGORY_DISPLAY_ORDER,
  CATEGORY_LABELS,
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
} from "@oboapp/shared";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { borderRadius } from "@/lib/colors";
import { Info } from "lucide-react";
import BackButton from "@/components/BackButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import ExperimentalFeaturesSection from "../ExperimentalFeaturesSection";
import { useEffect, useMemo } from "react";

export default function NotificationFiltersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const {
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
  } = useNotificationFilters();

  const sources = useMemo(() => {
    try {
      return getCurrentLocalitySources();
    } catch {
      return [];
    }
  }, []);

  const experimentalSources = useMemo(() => {
    try {
      return getExperimentalSources();
    } catch {
      return [];
    }
  }, []);

  /** All category values including "uncategorized" */
  const allCategoryValues = useMemo(
    () => [...CATEGORY_DISPLAY_ORDER, UNCATEGORIZED],
    [],
  );

  const allSourceIds = useMemo(() => sources.map((s) => s.id), [sources]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [authLoading, user, router]);

  // Warn user if they try to navigate away with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const handleSave = async () => {
    const success = await save();
    if (success) {
      router.push("/settings");
    }
  };

  const handleCancel = () => {
    resetToSaved();
    router.push("/settings");
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex justify-center items-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back button */}
        <div className="mb-6">
          <BackButton href="/settings" label="Настройки" />
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Филтри за известия
        </h1>

        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 mb-6 bg-info-light border border-info-border rounded-lg">
          <Info size={20} className="text-info flex-shrink-0 mt-0.5" />
          <p className="text-sm text-info">
            Промените ще се приложат само за бъдещи известия. Вече получените
            известия няма да бъдат засегнати.
          </p>
        </div>

        {error && (
          <div className="p-4 mb-6 bg-error-light border border-error-border rounded-lg text-error text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            {/* Filter sections */}
            <div className="bg-white rounded-lg shadow mb-6">
              <FilterSection
                title="Категории"
                description="Избери категориите, за които искаш да получаваш известия. Ако не избереш нищо, ще получаваш известия за съобщения, попадащи в зоните ти на интерес от всички категории."
                hasActiveFilters={selectedCategories.size > 0}
                allSelected={selectedCategories.size === allCategoryValues.length}
                onSelectAll={() => selectAllCategories(allCategoryValues)}
                onDeselectAll={deselectAllCategories}
              >
                {CATEGORY_DISPLAY_ORDER.map((category) => (
                  <CategoryFilterItem
                    key={category}
                    category={category}
                    label={CATEGORY_LABELS[category]}
                    checked={selectedCategories.has(category)}
                    onChange={() => toggleCategory(category)}
                  />
                ))}
                <CategoryFilterItem
                  category={UNCATEGORIZED}
                  label={UNCATEGORIZED_LABEL}
                  checked={selectedCategories.has(UNCATEGORIZED)}
                  onChange={() => toggleCategory(UNCATEGORIZED)}
                />
              </FilterSection>

              <FilterSection
                title="Източници"
                description="Избери от кои източници искаш да получаваш известия. Ако не избереш нищо, ще получаваш известия от всички източници за съобщения попадащи в зоните ти на интерес."
                hasActiveFilters={selectedSources.size > 0}
                allSelected={selectedSources.size === allSourceIds.length}
                onSelectAll={() => selectAllSources(allSourceIds)}
                onDeselectAll={deselectAllSources}
              >
                {sources.map((source) => (
                  <SourceFilterItem
                    key={source.id}
                    label={source.name}
                    checked={selectedSources.has(source.id)}
                    onChange={() => toggleSource(source.id)}
                  />
                ))}
              </FilterSection>
            </div>

            {/* Experimental features section */}
            <div className="bg-white rounded-lg shadow mb-6">
              <ExperimentalFeaturesSection
                enabled={experimentalFeatures}
                onToggle={setExperimentalFeatures}
                experimentalSources={experimentalSources}
              />
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !isDirty}
                className={`${buttonStyles.primary} ${buttonSizes.md} ${borderRadius.sm}`}
              >
                {isSaving ? "Запазване..." : "Запази"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isSaving}
                className={`${buttonStyles.ghost} ${buttonSizes.md} ${borderRadius.sm}`}
              >
                Отказ
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={
                  isSaving ||
                  (selectedCategories.size === 0 &&
                    selectedSources.size === 0 &&
                    !experimentalFeatures)
                }
                className={`${buttonStyles.secondary} ${buttonSizes.md} ${borderRadius.sm} ml-auto`}
              >
                Изчисти всички филтри
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

