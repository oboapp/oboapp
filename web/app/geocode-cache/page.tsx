import GeocodeCacheClient from "./GeocodeCacheClient";
import ReportPageUnavailable from "@/components/ReportPageUnavailable";
import { hasReportPagesEnabled } from "@/lib/report-pages";

export default function GeocodeCachePage() {
  if (!hasReportPagesEnabled()) {
    return (
      <ReportPageUnavailable
        title="Кеш на геокодирането"
        message="Тази страница е скрита, защото GCS_GENERIC_BUCKET не е конфигуриран за този fork."
        backHref="/sources"
        backLabel="Източници"
      />
    );
  }

  return <GeocodeCacheClient />;
}
