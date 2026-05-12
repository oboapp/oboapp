import type { Metadata } from "next";
import Link from "next/link";
import HistoryContent from "./HistoryContent";
import ReportPageUnavailable from "@/components/ReportPageUnavailable";
import { hasReportPagesEnabled } from "@/lib/report-pages";
import { APP_NAME } from "@/lib/pwa-metadata";

export const metadata: Metadata = {
  title: `Исторически данни | ${APP_NAME}`,
  description:
    "Топлинна карта на исторически данни от всички събрани съобщения",
};

export default function HistoryPage() {
  if (!hasReportPagesEnabled()) {
    return (
      <ReportPageUnavailable
        title="Исторически данни"
        message="Тази страница е скрита, защото GCS_GENERIC_BUCKET не е конфигуриран за този fork."
        backHref="/sources"
        backLabel="Източници"
      />
    );
  }

  return (
    <div className="min-h-screen bg-neutral-light flex flex-col">
      {/* Page header */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-6">
          <Link href="/" className="text-primary hover:text-primary-hover inline-flex items-center gap-2">
            <span>←</span>
            <span>Начало</span>
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-4">
          Исторически данни
        </h1>
        <p className="text-sm text-neutral">
          Топлинна карта на всички финализирани съобщения. Показва кои
          квартали се срещат по-често в данните на системата.
          Може да бъде показател за това къде е нужно да извлечем повече данни
          или за това къде районните администрации могат да
          споделят повече информация.
        </p>
      </div>

      {/* Stats, filters and full-height map */}
      <HistoryContent />
    </div>
  );
}
