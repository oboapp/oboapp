"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { InterestCoverageReportSchema } from "@oboapp/shared";
import type { InterestCoverageReport } from "@oboapp/shared";
import { formatDateTime } from "@/lib/date-format";

const CoverageMap = dynamic(() => import("./InterestCoverageMap"), { ssr: false });

export default function InterestCoverageContent() {
  const [report, setReport] = useState<InterestCoverageReport | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/interests/report", { signal: controller.signal });
        if (!response.ok) {
          if (controller.signal.aborted) return;
          setReport(null);
          setState(response.status === 503 ? "unavailable" : "error");
          return;
        }
        const raw: unknown = await response.json();
        if (typeof raw !== "object" || raw === null) throw new Error("Invalid report");
        const data = InterestCoverageReportSchema.parse(raw);
        if (controller.signal.aborted) return;
        setReport(data);
        setState(data.status === "available" ? "ready" : "unavailable");
      } catch {
        if (controller.signal.aborted) return;
        setReport(null);
        setState("error");
      }
    }
    void refresh();
    return () => { controller.abort(); };
  }, []);

  return (
    <section aria-label="Отчет за покритието" className="space-y-4">
      <div aria-live="polite">
        {state === "loading" && <p className="text-neutral">Зареждане на отчета…</p>}
        {state === "error" && <p className="text-error">Отчетът не може да се зареди. Опитай с презареждане на страницата.</p>}
        {state === "unavailable" && <p className="rounded-md border border-info-border bg-info-light p-4 text-info">Картата не е достъпна за този отчет. За показване са нужни поне 10 различни потребители и достатъчно общо покритие за защита на личните зони.</p>}
      </div>
      {report && <p className="text-sm text-neutral">Генериран: <time dateTime={report.generatedAt}>{formatDateTime(report.generatedAt)}</time>. Отчетът се обновява веднъж седмично.</p>}
      {state === "ready" && report?.summary && <>
        <dl className="flex flex-wrap gap-8 text-foreground">
          <div><dt className="text-sm text-neutral">Запазени зони</dt><dd className="text-xl font-bold">{report.summary.interests.min}–{report.summary.interests.max}</dd></div>
          <div><dt className="text-sm text-neutral">Различни потребители</dt><dd className="text-xl font-bold">{report.summary.users.min}–{report.summary.users.max}</dd></div>
        </dl>
        <p className="text-sm text-neutral">Броят е показан в диапазони. Цветните клетки включват само покритие с безопасно обобщаване. Някои зони са скрити за защита на личните данни.</p>
        <p className="text-sm text-neutral">Неоцветените райони нямат публикувано покритие: то може да липсва или да е скрито. Това не означава със сигурност, че там няма зони.</p>
        <div className="isolate"><CoverageMap report={report} /></div>
      </>}
    </section>
  );
}

