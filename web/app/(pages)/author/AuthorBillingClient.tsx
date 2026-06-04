"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import LoadingSpinner from "@/components/LoadingSpinner";

interface BillingServiceEntry {
  name: string;
  cost: number;
  credits?: number;
}

interface BillingMonthEntry {
  month: string;
  total: number;
  totalCredits?: number;
  byService: BillingServiceEntry[];
}

interface BillingCostReport {
  generatedAt: string;
  currency: string;
  months: BillingMonthEntry[];
}

interface MonthlyChartRow {
  month: string;
  gross: number;
  credits: number;
  net: number;
}

interface StackConfig {
  topServices: string[];
  stackRows: Array<Record<string, number | string>>;
}

const SERVICE_LABELS: Record<string, string[]> = {
  Firestore: ["App Engine"],
  "Cloud Run": [
    "Cloud Run",
    "Cloud Build",
    "Artifact Registry",
    "Cloud Scheduler",
  ],
  "Cloud Storage": ["Cloud Storage"],
  Gemini: ["Gemini API"],
  "Maps Platform": ["Geocoding API", "Maps API", "Maps Static API"],
};

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  Firestore:
    "Базата данни. Всичко, което обработваме, записваме и показваме е тук.",
  "Cloud Run":
    "Тук се върши цялата работа. Цялата обработка и автоматизация се контролира от тук.",
  "Cloud Storage":
    "Съхранява малко количесто файлове, които рядко се обновяват, включително данните, показани на тази страница.",
  Gemini:
    "AI обработка на съобщенията за извличане на структурирани данни, намиране на съвпадения, категоризация.",
  "Maps Platform":
    "Заедно с други услуги се ползва за геокодиране (превръщане на адреси в координати) и показване на карти.",
};

const SERVICE_COLORS: Record<string, string> = {
  "Cloud Run": "var(--color-primary)",
  Firestore: "var(--color-success)",
  "Cloud Storage": "var(--color-destructive)",
  Gemini: "var(--color-warning)",
  "Maps Platform": "var(--color-info)",
  Others: "var(--color-neutral)",
  Invoice: "var(--color-info-hover)",
};

function getGroupLabel(serviceName: string): string {
  for (const [groupLabel, services] of Object.entries(SERVICE_LABELS)) {
    if (services.includes(serviceName)) {
      return groupLabel;
    }
  }
  return "Others";
}

function getServiceColor(serviceName: string): string {
  return SERVICE_COLORS[serviceName] ?? SERVICE_COLORS.Others;
}

function formatMonthLabel(month: string): string {
  const [year, monthPart] = month.split("-");
  if (!year || !monthPart) {
    return month;
  }

  const asDate = new Date(Date.UTC(Number(year), Number(monthPart) - 1, 1));
  if (Number.isNaN(asDate.getTime())) {
    return month;
  }

  return new Intl.DateTimeFormat("bg-BG", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(asDate);
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("bg-BG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getServiceDescription(serviceName: string): string {
  return (
    SERVICE_DESCRIPTIONS[serviceName] ??
    "Обща инфраструктурна услуга за работа на приложението."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBillingCostReport(value: unknown): value is BillingCostReport {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.generatedAt !== "string" ||
    typeof value.currency !== "string" ||
    !Array.isArray(value.months)
  ) {
    return false;
  }

  return value.months.every((month) => {
    if (!isRecord(month)) {
      return false;
    }

    if (
      typeof month.month !== "string" ||
      typeof month.total !== "number" ||
      (month.totalCredits !== undefined &&
        typeof month.totalCredits !== "number") ||
      !Array.isArray(month.byService)
    ) {
      return false;
    }

    return month.byService.every((service) => {
      if (!isRecord(service)) {
        return false;
      }

      return (
        typeof service.name === "string" &&
        typeof service.cost === "number" &&
        (service.credits === undefined || typeof service.credits === "number")
      );
    });
  });
}

function LoadingState() {
  return (
    <div className="rounded-lg border border-neutral-border bg-white p-6 shadow-sm">
      <div
        className="flex items-center gap-3 text-sm text-neutral"
        role="status"
        aria-live="polite"
      >
        <LoadingSpinner />
        <span>Зарежда се отчетът за разходите...</span>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  readonly error: string | null;
}

function ErrorState({ error }: ErrorStateProps) {
  return (
    <div className="rounded-lg border border-error-border bg-error-light p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Отчетът не е наличен
      </h3>
      <p className="text-sm text-error">
        {error ?? "Липсват данни за разходите в момента."}
      </p>
    </div>
  );
}

interface SummaryCardProps {
  readonly lastUpdated: string | null;
  readonly latestMonthSummary: {
    readonly monthLabel: string;
    readonly gross: number;
    readonly discounts: number;
    readonly net: number;
  } | null;
  readonly currency: string;
}

function SummaryCard({
  lastUpdated,
  latestMonthSummary,
  currency,
}: SummaryCardProps) {
  return (
    <div className="rounded-lg border border-neutral-border bg-white p-6 shadow-sm">
      <p className="text-sm text-neutral">
        Последна актуализация:{" "}
        <span className="text-foreground font-medium">{lastUpdated}</span>
      </p>
      {latestMonthSummary ? (
        <div className="mt-3">
          <p className="text-sm text-neutral mb-3">
            Показваме най-новия месец: {latestMonthSummary.monthLabel}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border border-neutral-border bg-neutral-light p-4">
              <p className="text-xs uppercase tracking-wide text-neutral">
                Бруто
              </p>
              <p className="text-xl font-semibold text-foreground">
                {formatCurrency(latestMonthSummary.gross, currency)}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-border bg-neutral-light p-4">
              <p className="text-xs uppercase tracking-wide text-neutral">
                Отстъпки
              </p>
              <p className="text-xl font-semibold text-foreground">
                {formatCurrency(latestMonthSummary.discounts, currency)}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-border bg-neutral-light p-4">
              <p className="text-xs uppercase tracking-wide text-neutral">
                Нетно
              </p>
              <p className="text-xl font-semibold text-foreground">
                {formatCurrency(latestMonthSummary.net, currency)}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral mt-4">
          Няма налични месечни данни.
        </p>
      )}
    </div>
  );
}

interface MonthlyTrendChartProps {
  readonly monthlyRows: MonthlyChartRow[];
  readonly currency: string;
}

function MonthlyTrendChart({ monthlyRows, currency }: MonthlyTrendChartProps) {
  return (
    <div className="rounded-lg border border-neutral-border bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-foreground mb-4">
        Месечен тренд
      </h3>
      <p className="text-sm text-neutral mb-3">
        Сравнението е между{" "}
        <span className="font-medium text-foreground">бруто</span> (преди
        отстъпки) и <span className="font-medium text-foreground">нетно</span>{" "}
        (след GCP кредити/отстъпки). Фокусът е върху нетното, защото това е
        реалната сума, която плащаме.
      </p>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={monthlyRows}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-neutral-border)"
            />
            <XAxis
              dataKey="month"
              tickFormatter={formatMonthLabel}
              tick={{ fill: "var(--color-neutral)", fontSize: 12 }}
            />
            <YAxis
              tick={{ fill: "var(--color-neutral)", fontSize: 12 }}
              tickFormatter={(value: number) =>
                `${value.toFixed(0)} ${currency}`
              }
            />
            <Tooltip
              formatter={(value) =>
                formatCurrency(
                  typeof value === "number" ? value : 0,
                  currency,
                )
              }
              labelFormatter={(label) =>
                formatMonthLabel(
                  typeof label === "string" ? label : String(label ?? ""),
                )
              }
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="net"
              name="Нетно (след отстъпки)"
              stroke="var(--color-success)"
              fill="var(--color-success-light)"
              fillOpacity={0.6}
            />
            <Line
              type="monotone"
              dataKey="gross"
              name="Бруто (преди отстъпки)"
              stroke="var(--color-primary)"
              strokeDasharray="5 4"
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface ServiceDistributionChartProps {
  readonly stackConfig: StackConfig;
  readonly currency: string;
  readonly activeService: string | null;
  readonly setActiveService: (service: string | null) => void;
  readonly latestMonthSummary: {
    readonly monthLabel: string;
    readonly gross: number;
    readonly discounts: number;
    readonly net: number;
  } | null;
  readonly report: BillingCostReport;
}

function ServiceDistributionChart({
  stackConfig,
  currency,
  activeService,
  setActiveService,
  latestMonthSummary,
  report,
}: ServiceDistributionChartProps) {
  const getLegendServiceName = (entry: unknown): string | null => {
    if (!isRecord(entry)) {
      return null;
    }

    if (typeof entry.value === "string") {
      return entry.value;
    }

    if (typeof entry.dataKey === "string") {
      return entry.dataKey;
    }

    return null;
  };

  return (
    <div className="rounded-lg border border-neutral-border bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-foreground mb-4">
        Разпределение по услуги
      </h3>
      <p className="text-sm text-neutral mb-3">
        Показваме само услугите, които са налични в JSON отчета за всеки
        месец.
      </p>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stackConfig.stackRows}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-neutral-border)"
            />
            <XAxis
              dataKey="month"
              tickFormatter={formatMonthLabel}
              tick={{ fill: "var(--color-neutral)", fontSize: 12 }}
            />
            <YAxis
              tick={{ fill: "var(--color-neutral)", fontSize: 12 }}
              tickFormatter={(value: number) =>
                `${value.toFixed(0)} ${currency}`
              }
            />
            <Legend
              wrapperStyle={{ cursor: "pointer" }}
              onClick={(entry) => {
                const serviceName = getLegendServiceName(entry);
                if (serviceName) {
                  setActiveService(serviceName);
                }
              }}
            />
            {stackConfig.topServices.map((serviceName) => (
              <Bar
                key={serviceName}
                dataKey={serviceName}
                name={serviceName}
                stackId="services"
                fill={getServiceColor(serviceName)}
                cursor="pointer"
                onMouseEnter={() => setActiveService(serviceName)}
                onMouseLeave={() => setActiveService(null)}
                onClick={() => {
                  setActiveService(
                    activeService === serviceName ? null : serviceName,
                  );
                }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {latestMonthSummary && (
        <p className="mt-4 text-sm text-neutral leading-6">
          За {latestMonthSummary.monthLabel} общата сума е{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(latestMonthSummary.gross, currency)}
          </span>
          . С{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(latestMonthSummary.discounts, currency)}
          </span>{" "}
          отстъпки плащаме{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(latestMonthSummary.net, currency)}
          </span>
          {", което се вижда в графиката по-горе (нетно)."}
        </p>
      )}
    </div>
  );
}

interface ServiceDescriptionsGridProps {
  readonly report: BillingCostReport;
  readonly activeService: string | null;
  readonly setActiveService: (service: string | null) => void;
  readonly serviceCardRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
}

function ServiceDescriptionsGrid({
  report,
  activeService,
  setActiveService,
  serviceCardRefs,
}: ServiceDescriptionsGridProps) {
  return (
    <div className="rounded-lg border border-neutral-border bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-foreground mb-3">
        За какво всъщност се плаща
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          ...new Set(
            report.months.flatMap((month) =>
              month.byService.map((service) => getGroupLabel(service.name)),
            ),
          ),
        ]
          .filter((groupLabel) => groupLabel !== "Others")
          .map((groupLabel) => (
            <div
              key={groupLabel}
              ref={(el) => {
                serviceCardRefs.current[groupLabel] = el;
              }}
              className={`rounded-md transition-colors ${
                activeService === groupLabel
                  ? "border-info bg-info-light"
                  : "border-neutral-border"
              }`}
            >
              <p className="text-sm font-medium text-foreground">
                {groupLabel}
              </p>
              <p className="text-sm text-neutral mt-1">
                {getServiceDescription(groupLabel)}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}

export default function AuthorBillingClient() {
  const [report, setReport] = useState<BillingCostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string | null>(null);
  const serviceCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let isCurrentRequest = true;
    const controller = new AbortController();

    async function loadReport() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/billing/report", {
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Грешка при зареждане: ${res.status}`);
        }

        const data: unknown = await res.json();
        if (!isBillingCostReport(data)) {
          throw new TypeError("Невалиден формат на отчета");
        }
        if (!isCurrentRequest) {
          return;
        }
        setReport(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (!isCurrentRequest) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Неочаквана грешка";
        setError(message);
      } finally {
        if (isCurrentRequest) {
          setLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      isCurrentRequest = false;
      controller.abort();
    };
  }, []);

  const monthlyRows = useMemo<MonthlyChartRow[]>(() => {
    if (!report) {
      return [];
    }

    return [...report.months].reverse().map((entry) => {
      const credits = entry.totalCredits ?? 0;
      return {
        month: entry.month,
        gross: entry.total,
        credits,
        net: Math.max(entry.total - credits, 0),
      };
    });
  }, [report]);

  const stackConfig = useMemo<StackConfig>(() => {
    if (!report) {
      return {
        topServices: [],
        stackRows: [],
      };
    }

    // Group services by their label and sum costs
    const totalsByGroup = new Map<string, number>();
    for (const month of report.months) {
      for (const service of month.byService) {
        const groupLabel = getGroupLabel(service.name);
        totalsByGroup.set(
          groupLabel,
          (totalsByGroup.get(groupLabel) ?? 0) + service.cost,
        );
      }
    }

    // Sort by total cost descending
    const topServices = [...totalsByGroup.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    // Build rows with grouped data
    const stackRows = [...report.months].reverse().map((month) => {
      const row: Record<string, number | string> = {
        month: month.month,
      };

      // Group services for this month
      const costByGroup = new Map<string, number>();
      for (const service of month.byService) {
        const groupLabel = getGroupLabel(service.name);
        costByGroup.set(
          groupLabel,
          (costByGroup.get(groupLabel) ?? 0) + service.cost,
        );
      }

      for (const serviceName of topServices) {
        row[serviceName] = costByGroup.get(serviceName) ?? 0;
      }

      return row;
    });

    return {
      topServices,
      stackRows,
    };
  }, [report]);

  const lastUpdated = useMemo(() => {
    if (!report) {
      return null;
    }

    const asDate = new Date(report.generatedAt);
    if (Number.isNaN(asDate.getTime())) {
      return report.generatedAt;
    }

    return new Intl.DateTimeFormat("bg-BG", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(asDate);
  }, [report]);

  const latestMonthSummary = useMemo(() => {
    if (!report || report.months.length === 0) {
      return null;
    }

    const latest = report.months[0];
    const gross = latest.total;
    const discounts = latest.totalCredits ?? 0;
    const net = Math.max(gross - discounts, 0);

    return {
      monthLabel: formatMonthLabel(latest.month),
      gross,
      discounts,
      net,
    };
  }, [report]);

  if (loading) {
    return <LoadingState />;
  }

  if (error || !report) {
    return <ErrorState error={error} />;
  }

  return (
    <div className="space-y-6">
      <SummaryCard
        lastUpdated={lastUpdated}
        latestMonthSummary={latestMonthSummary}
        currency={report.currency}
      />

      <MonthlyTrendChart monthlyRows={monthlyRows} currency={report.currency} />

      <ServiceDistributionChart
        stackConfig={stackConfig}
        currency={report.currency}
        activeService={activeService}
        setActiveService={setActiveService}
        latestMonthSummary={latestMonthSummary}
        report={report}
      />

      <ServiceDescriptionsGrid
        report={report}
        activeService={activeService}
        setActiveService={setActiveService}
        serviceCardRefs={serviceCardRefs}
      />
    </div>
  );
}
