import type { Metadata } from "next";
import Link from "next/link";
import AuthorBillingClient from "./AuthorBillingClient";
import { AuthorIntroSection, SupportCard } from "./AuthorSections";
import ReportPageUnavailable from "@/components/ReportPageUnavailable";
import { hasReportPagesEnabled } from "@/lib/report-pages";
import { APP_NAME } from "@/lib/pwa-metadata";

export const revalidate = 86400;

const PAGE_TITLE = `За автора и разходите | ${APP_NAME}`;
const PAGE_DESCRIPTION =
  "Страница за автора, историята на проекта и текущите разходи по поддръжката.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/author",
    siteName: APP_NAME,
    locale: "bg_BG",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
};

export default function AuthorPage() {
  if (!hasReportPagesEnabled()) {
    return (
      <ReportPageUnavailable
        title="За автора и разходите"
        message="Тази страница е скрита, защото GCS_GENERIC_BUCKET не е конфигуриран за този fork."
        backHref="/sources"
        backLabel="Източници"
      />
    );
  }

  return (
    <main className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-6">
          <Link
            href="/"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span aria-hidden="true">←</span>
            <span>Начало</span>
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-foreground mb-8">
          За автора и разходите
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
          <div className="space-y-8">
            <AuthorIntroSection />

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">
                Колко струва?
              </h2>
              <AuthorBillingClient />
            </section>
          </div>

          <aside className="hidden lg:block lg:sticky lg:top-24">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">
                Как можеш да подкрепиш?
              </h2>
              <SupportCard />
            </section>
          </aside>
        </div>
      </div>

      <div className="lg:hidden fixed bottom-16 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-1rem)] max-w-sm">
        <SupportCard />
      </div>
    </main>
  );
}
