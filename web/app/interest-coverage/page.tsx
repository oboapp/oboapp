import type { Metadata } from "next";
import Link from "next/link";
import { hasReportPagesEnabled } from "@/lib/report-pages";
import { APP_NAME } from "@/lib/pwa-metadata";
import ReportPageUnavailable from "@/components/ReportPageUnavailable";
import InterestCoverageContent from "./InterestCoverageContent";

export const metadata: Metadata = {
  title: `Покритие на зоните | ${APP_NAME}`,
  description: "Топлинна карта на интереса към известия според запазените зони",
};

export default function InterestCoveragePage() {
  if (!hasReportPagesEnabled()) return <ReportPageUnavailable title="Покритие на зоните" message="Отчетът не е достъпен за тази версия на приложението." backHref="/sources" backLabel="Източници" />;
  return (
    <main className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-4">
        <Link href="/" className="text-link hover:text-link-hover hover:underline">← Начало</Link>
        <h1 className="text-3xl font-bold text-foreground">Покритие на зоните</h1>
        <p className="text-sm text-neutral">Къде най-много хора искат да получават известия? Топлинната карта показва интереса според запазените зони. По-топлите цветове означават повече различни потребители с интерес към района.</p>
        <p className="text-sm text-neutral">Припокриващите се зони на един човек се броят веднъж на всяко място. Картата е с намалена точност и скрива местата с малко хора. Включени са и хора без активирани push известия.</p>
        <p className="text-sm text-neutral">Картата показва заявен интерес към датата на отчета. Броят на изпратените известия и местата на публикуваните съобщения са отделни данни. Местата на съобщенията са показани в <Link href="/history" className="text-link hover:underline">историческата карта</Link>.</p>
        <InterestCoverageContent />
      </div>
    </main>
  );
}
