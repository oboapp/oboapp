import { Metadata } from "next";
import Link from "next/link";
import { getCurrentLocalitySources } from "@/lib/source-utils";
import geocodingSources from "@/lib/geocoding-sources";
import { hasReportPagesEnabled } from "@/lib/report-pages";
import SourceCard from "@/components/SourceCard";
import GeocodingSourceCard from "@/components/GeocodingSourceCard";
import { APP_NAME } from "@/lib/pwa-metadata";

export const metadata: Metadata = {
  title: `Източници - ${APP_NAME}`,
  description: "Източници на данни за събития и уведомления",
};

export default function SourcesPage() {
  // Get only sources applicable to the current locality
  const sources = getCurrentLocalitySources();

  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>Начало</span>
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-foreground mb-8">
          Източници на данни
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>

        <h2
          className="text-2xl font-semibold text-foreground mb-2 mt-12"
          lang="en"
        >
          Geocoding
        </h2>
        {hasReportPagesEnabled() && (
          <p className="text-sm mb-6">
            <Link
              href="/geocode-cache"
              className="text-link hover:text-link-hover hover:underline"
            >
              Преглед на кеша →
            </Link>
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {geocodingSources.map((source) => (
            <GeocodingSourceCard key={source.id} source={source} />
          ))}
        </div>
      </div>
    </div>
  );
}
