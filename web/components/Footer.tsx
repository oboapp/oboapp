"use client";

import Link from "next/link";
import { APP_NAME } from "@/lib/pwa-metadata";

interface FooterProps {
  readonly className?: string;
  readonly showHistoryReportLink: boolean;
}

const ABOUT_OBOAPP_LINKS = [
  { href: "/kak-se-rodi", label: "Как се роди?" },
  { href: "/open-source", label: `${APP_NAME} е отворен` },
  { href: "/author", label: "За автора и разходите" },
] as const;

const DATA_AND_REPORTS_LINKS = [
  { href: "/sources", label: "Източници на данни" },
  { href: "/ingest-errors", label: "Съобщения с грешки" },
  { href: "/unreadable", label: "Нелокализирани съобщения" },
  { href: "/events", label: "Групирани съобщения" },
] as const;

export default function Footer({
  className = "",
  showHistoryReportLink,
}: FooterProps) {
  const dataAndReportsLinks = showHistoryReportLink
    ? [
        ...DATA_AND_REPORTS_LINKS.slice(0, 2),
        { href: "/history", label: "Исторически данни" },
        ...DATA_AND_REPORTS_LINKS.slice(2),
      ]
    : DATA_AND_REPORTS_LINKS;

  return (
    <footer className={`border-t border-neutral-border ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row gap-8">
          <div className="flex-1">
            <h3 className="font-bold text-lg mb-4 text-foreground">
              За <span translate="no">{APP_NAME}</span>
            </h3>
            <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm">
              {ABOUT_OBOAPP_LINKS.map(({ href, label }) => (
                <div key={href}>
                  <Link
                    href={href}
                    className="text-link hover:text-link-hover hover:underline"
                  >
                    {label}
                  </Link>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-2">
            <h3 className="font-bold text-lg mb-4 text-foreground">
              Данни и отчети
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {dataAndReportsLinks.map(({ href, label }) => (
                <div key={href}>
                  <Link
                    href={href}
                    className="text-link hover:text-link-hover hover:underline"
                  >
                    {label}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
