import type { Metadata } from "next";
import Link from "next/link";
import NotificationsReportClient from "./NotificationsReportClient";
import ReportPageUnavailable from "@/components/ReportPageUnavailable";
import { hasReportPagesEnabled } from "@/lib/report-pages";
import { APP_NAME } from "@/lib/pwa-metadata";

export const metadata: Metadata = {
  title: `Отчет за известията | ${APP_NAME}`,
  description:
    "Изпратени известия, кликове и отваряния от историята — общо и по източник.",
};

export default function NotificationsReportPage() {
  if (!hasReportPagesEnabled()) {
    return (
      <ReportPageUnavailable
        title="Отчет за известията"
        message="Отчетът за известията не е достъпен за тази версия на приложението."
        backHref="/sources"
        backLabel="Източници"
      />
    );
  }
  return (
    <div className="min-h-screen bg-neutral-light px-4 sm:px-6 lg:px-8 py-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <Link
          href="/"
          className="text-link hover:text-link-hover hover:underline"
        >
          ← Начало
        </Link>
        <h1 className="text-3xl font-bold text-foreground">
          Отчет за известията
        </h1>
        <NotificationsReportClient />
      </div>
    </div>
  );
}
