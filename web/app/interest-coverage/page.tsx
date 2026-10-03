import type { Metadata } from "next";
import Link from "next/link";
import { hasReportPagesEnabled } from "@/lib/report-pages";
import { APP_NAME } from "@/lib/pwa-metadata";
import ReportPageUnavailable from "@/components/ReportPageUnavailable";
import InterestCoverageContent from "./InterestCoverageContent";

export const metadata: Metadata = {
  title: `Покритие на зоните | ${APP_NAME}`,
  description: "Анонимизиран отчет за географското покритие на запазените зони на интерес",
};

export default function InterestCoveragePage() {
  if (!hasReportPagesEnabled()) return <ReportPageUnavailable title="Покритие на зоните" message="Отчетът не е достъпен за тази версия на приложението." backHref="/sources" backLabel="Източници" />;
  return (
    <main className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-4">
        <Link href="/" className="text-link hover:text-link-hover hover:underline">← Начало</Link>
        <h1 className="text-3xl font-bold text-foreground">Покритие на зоните</h1>
        <p className="text-sm text-neutral">Анонимизиран отчет за запазените зони на интерес. Покритието отчита радиуса на зоните и показва обобщени клетки с размер около 2 км. Припокриващите се зони на един човек се броят веднъж във всяка клетка.</p>
        <p className="text-sm text-neutral">Включени са запазените зони независимо от регистрацията за push известия. Картата показва потенциално географско покритие към датата на отчета. Тя не показва дали наскоро е имало съобщения, подходящи за известяване.</p>
        <p className="text-sm text-neutral">За получаване на известие са важни и датата на съобщението спрямо създаването на зоната, краят на събитието, обработката, геометрията и личните филтри. <Link href="/history" className="text-link hover:underline">Историческите данни</Link> също не доказват наличие на подходящи скорошни съобщения.</p>
        <InterestCoverageContent />
      </div>
    </main>
  );
}
