"use client";

import { useEffect, useState } from "react";

interface FrequencyEntry {
  key: string;
  originalText: string;
  count: number;
  cached: boolean;
}

interface Report {
  generatedAt: string;
  messagesAnalyzed: number;
  pins: FrequencyEntry[];
  streets: FrequencyEntry[];
}

function FrequencyTable({
  title,
  entries,
  showAll,
}: {
  title: string;
  entries: FrequencyEntry[];
  showAll: boolean;
}) {
  const shown = showAll ? entries : entries.slice(0, 50);
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-neutral mb-3">{title}</h2>
      <div className="overflow-x-auto rounded border border-neutral-border">
        <table className="w-full text-sm">
          <thead className="bg-neutral-light text-neutral text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Адрес</th>
              <th className="px-3 py-2 font-medium w-20 text-right">Брой</th>
              <th className="px-3 py-2 font-medium w-24 text-center">Кеширан</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr
                key={e.key}
                className="border-t border-neutral-border hover:bg-neutral-light/50"
              >
                <td className="px-3 py-2">
                  <span className="text-neutral">{e.originalText}</span>
                  <span className="ml-2 text-xs text-neutral/50">{e.key}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{e.count}</td>
                <td className="px-3 py-2 text-center">
                  {e.cached ? (
                    <span className="text-success text-xs font-medium">✓ Да</span>
                  ) : (
                    <span className="text-destructive text-xs font-medium">✗ Не</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && entries.length > 50 && (
        <p className="mt-2 text-xs text-neutral/60">
          Показани 50 от {entries.length} резултата.
        </p>
      )}
    </section>
  );
}

export default function GeocodeCachePage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filterUncached, setFilterUncached] = useState(false);

  useEffect(() => {
    fetch("/api/geocode-cache/report")
      .then((r) => {
        if (!r.ok) throw new Error(`Грешка ${r.status}`);
        return r.json() as Promise<Report>;
      })
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <p className="text-neutral/60 text-sm">Зарежда се...</p>
      </div>
    );
  }

  const pins = filterUncached ? report.pins.filter((p) => !p.cached) : report.pins;
  const streets = filterUncached
    ? report.streets.filter((s) => !s.cached)
    : report.streets;

  const cachedPinCount = report.pins.filter((p) => p.cached).length;
  const cachedStreetCount = report.streets.filter((s) => s.cached).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral mb-1">
        Кеш на геокодирането
      </h1>
      <p className="text-sm text-neutral/60 mb-6">
        Генериран: {new Date(report.generatedAt).toLocaleString("bg-BG")} ·{" "}
        Анализирани съобщения: {report.messagesAnalyzed.toLocaleString("bg-BG")}
      </p>

      <div className="flex gap-6 mb-6 text-sm">
        <div>
          <span className="font-semibold">{cachedPinCount}</span>
          <span className="text-neutral/60"> / {report.pins.length} адреса кеширани</span>
        </div>
        <div>
          <span className="font-semibold">{cachedStreetCount}</span>
          <span className="text-neutral/60"> / {report.streets.length} улици кеширани</span>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          className="text-xs px-3 py-1.5 rounded border border-neutral-border hover:bg-neutral-light transition-colors cursor-pointer"
          onClick={() => setFilterUncached((v) => !v)}
        >
          {filterUncached ? "Покажи всички" : "Само некеширани"}
        </button>
        <button
          className="text-xs px-3 py-1.5 rounded border border-neutral-border hover:bg-neutral-light transition-colors cursor-pointer"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Покажи топ 50" : "Покажи всички"}
        </button>
      </div>

      <FrequencyTable
        title={`Адреси (пинове) — ${pins.length}`}
        entries={pins}
        showAll={showAll}
      />
      <FrequencyTable
        title={`Улици — ${streets.length}`}
        entries={streets}
        showAll={showAll}
      />
    </div>
  );
}
