"use client";

import { useQuery } from "@tanstack/react-query";
import {
  NotificationsReportSnapshotSchema,
  type NotificationsReportSnapshot,
} from "@oboapp/shared/schema";
import { getCurrentLocalitySources } from "@/lib/source-utils";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { getButtonClasses } from "@/lib/theme";

async function fetchReport(): Promise<NotificationsReportSnapshot> {
  const response = await fetch("/api/notifications/report").catch(() => {
    throw new Error("Връзката с отчета не успя. Опитай отново.");
  });
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? "Отчетът все още не е наличен. Опитай отново по-късно."
        : "Отчетът не успя да се зареди.",
    );
  }
  try {
    return NotificationsReportSnapshotSchema.parse(await response.json());
  } catch {
    throw new Error(
      "Данните в отчета не успяха да се заредят. Опитай отново по-късно.",
    );
  }
}

export default function NotificationsReportClient() {
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ["notifications-report"],
    queryFn: fetchReport,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
  if (isPending)
    return (
      <p role="status" className="text-neutral">
        Зареждане на отчета…
      </p>
    );
  if (error || !data) {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-error">
          {error instanceof Error
            ? error.message
            : "Отчетът не успя да се зареди."}
        </p>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch()}
          className={getButtonClasses("primary")}
        >
          Опитай отново
        </button>
      </div>
    );
  }
  const names = new Map(
    getCurrentLocalitySources().map((source) => [source.id, source.name]),
  );
  const cards = [
    { label: "Изпратени известия", value: data.kpis.sent },
    { label: "Получатели", value: data.kpis.uniqueUsers },
    { label: "Кликове от push известия", value: data.kpis.clicked },
    { label: "Отворени от историята", value: data.kpis.opened },
  ];
  return (
    <div className="space-y-6">
      <div className="text-sm text-neutral space-y-2">
        <p>
          Обновява се всяка седмица. Последно обновяване:{" "}
          {formatDateTime(data.generatedAt)}.
        </p>
        {data.periodStart && data.periodEnd && (
          <p>
            Дати на обработените известия: {formatDate(data.periodStart)} –{" "}
            {formatDate(data.periodEnd)}.
          </p>
        )}
        {data.firstRecordedClickAt && (
          <p>
            Първи записан push клик в отчета:{" "}
            {formatDate(data.firstRecordedClickAt)}.
          </p>
        )}
        <p>
          Отчетът обхваща наличните записи. Изтриването на съобщения или профили
          може да намали броя им.
        </p>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value }) => (
          <div
            key={label}
            className="bg-white rounded-lg border border-neutral-border p-5"
          >
            <dt className="text-sm text-neutral">{label}</dt>
            <dd className="text-3xl font-bold text-primary mt-2">
              {value.toLocaleString("bg-BG")}
            </dd>
          </div>
        ))}
      </dl>
      <div className="text-sm text-neutral space-y-2">
        <p>
          Едно изпратено известие означава поне едно успешно предаване към
          Firebase Cloud Messaging за даден получател и съобщение. Това не
          потвърждава показване на устройството.
        </p>
        <p>
          Кликовете и отварянията се броят само сред успешно изпратените
          известия, по веднъж за всяко действие. Отваряне от историята и клик
          върху push известие са различни действия и може да се припокриват.
        </p>
        <p>
          Обработени записи: {data.kpis.processed.toLocaleString("bg-BG")}.
          Неуспешно изпращане: {data.kpis.failed.toLocaleString("bg-BG")}. Без
          абонамент: {data.kpis.noSubscriptions.toLocaleString("bg-BG")}. Без
          данни за изпращането:{" "}
          {data.kpis.unknownDelivery.toLocaleString("bg-BG")}.
        </p>
      </div>
      {data.kpis.processed === 0 ? (
        <p className="text-neutral">Все още няма обработени известия.</p>
      ) : (
        <section className="bg-white rounded-lg border border-neutral-border p-4 sm:p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            По източник
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <caption className="sr-only">
                Изпращане и действия по източник
              </caption>
              <thead className="bg-neutral-surface text-foreground">
                <tr>
                  {[
                    "Източник",
                    "Изпратени",
                    "Push кликове",
                    "От историята",
                    "Неуспешни",
                    "Без абонамент",
                    "Без данни",
                  ].map((label, index) => (
                    <th
                      key={label}
                      scope="col"
                      className={`px-3 py-3 ${index === 0 ? "text-left" : ""}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-neutral">
                {data.sources.map((row) => (
                  <tr
                    key={row.source}
                    className="border-t border-neutral-border"
                  >
                    <th
                      scope="row"
                      className="text-left px-3 py-3 font-medium text-foreground"
                    >
                      {names.get(row.source) ??
                        (row.source === "(unknown)"
                          ? "Неизвестен източник"
                          : row.source)}
                    </th>
                    {[
                      row.sent,
                      row.clicked,
                      row.opened,
                      row.failed,
                      row.noSubscriptions,
                      row.unknownDelivery,
                    ].map((value, index) => (
                      <td key={index} className="px-3 py-3">
                        {value.toLocaleString("bg-BG")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
