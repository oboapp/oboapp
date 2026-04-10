"use client";

import { useCallback, useMemo, useState, Suspense } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import Card from "@/components/Card";
import MessagesGrid from "@/components/MessagesGrid";
import MessageDetailView from "@/components/MessageDetailView/MessageDetailView";
import { useMessageByIdFallback } from "@/lib/hooks/useMessageByIdFallback";
import { navigateBackOrReplace } from "@/lib/navigation-utils";
import type { Message } from "@/lib/types";

// Leaflet requires a browser DOM — load client-side only
const AirQualityMap = dynamic(() => import("@/components/AirQualityMap"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-80 rounded-lg border border-neutral-border bg-neutral-light">
      <div className="text-center space-y-2">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-neutral">Зареждане на картата...</p>
      </div>
    </div>
  ),
});

const LOCALITY = process.env.NEXT_PUBLIC_LOCALITY ?? "bg.sofia";
const SOURCE_ID = "sensor-community";

interface AqiCell {
  id: string;
  aqi: number | null;
  aqiLabel: string | null;
  aqiCategory: string | null;
  sensorCount: number;
  bounds: { south: number; north: number; west: number; east: number } | null;
}

interface AirQualityStatus {
  locality: string;
  updatedAt: string;
  readings: {
    count: number;
    uniqueSensors: number;
    oldestAt: string | null;
    newestAt: string | null;
    isStale: boolean;
  };
  cells: AqiCell[];
  maxAqi: number | null;
  stats: {
    messageCount: number;
    notificationCount: number;
  };
}

async function fetchStatus(locality: string): Promise<AirQualityStatus> {
  const res = await fetch(
    `/api/air-quality/status?locality=${encodeURIComponent(locality)}`,
  );
  if (!res.ok) throw new Error("Грешка при зареждане на данните");
  return res.json();
}

async function fetchMessages(): Promise<Message[]> {
  const res = await fetch(
    `/api/messages/by-source?sourceId=${encodeURIComponent(SOURCE_ID)}&limit=12`,
  );
  if (!res.ok) throw new Error("Грешка при зареждане на съобщенията");
  const data = await res.json();
  return data.messages ?? [];
}

function aqiCategoryClasses(category: string): string {
  switch (category) {
    case "good":
      return "bg-success-light text-success border border-success-border";
    case "fair":
      return "bg-success-light text-success border border-success-border";
    case "moderate":
      return "bg-warning-light text-warning border border-warning-border";
    case "poor":
      return "bg-warning-light text-warning border border-warning-border";
    case "very-poor":
      return "bg-error-light text-error border border-error-border";
    case "extremely-poor":
      return "bg-error-light text-error border border-error-border";
    default:
      return "bg-neutral-light text-neutral border border-neutral-border";
  }
}

function StatCard({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string | number;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <p className="text-sm text-neutral mb-1">{label}</p>
      <p
        className={`text-3xl font-bold ${valueClassName ?? "text-foreground"}`}
      >
        {value}
      </p>
      {sub && <p className="text-sm text-neutral mt-1">{sub}</p>}
    </Card>
  );
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AirQualityPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    data: status,
    isLoading: statusLoading,
    isError: statusError,
  } = useQuery({
    queryKey: ["airQualityStatus", LOCALITY],
    queryFn: () => fetchStatus(LOCALITY),
    refetchInterval: 60_000,
  });

  const {
    data: messages = [],
    isLoading: messagesLoading,
    isError: messagesError,
  } = useQuery({
    queryKey: ["airQualityMessages"],
    queryFn: fetchMessages,
  });

  const [logoError, setLogoError] = useState(false);

  const messageId = searchParams.get("messageId");
  const listMatch = useMemo(
    () => messages.find((m) => m.id === messageId) ?? null,
    [messageId, messages],
  );
  const selectedMessage = useMessageByIdFallback(messageId, listMatch);

  const handleMessageClick = useCallback(
    (message: Message) => {
      router.push(
        `/air-quality?messageId=${encodeURIComponent(String(message.id))}`,
        { scroll: false },
      );
    },
    [router],
  );

  const handleCloseDetail = useCallback(() => {
    navigateBackOrReplace(router, "/air-quality");
  }, [router]);

  const handleAddressClick = useCallback(
    (lat: number, lng: number) => {
      router.push(`/?lat=${lat}&lng=${lng}`, { scroll: false });
    },
    [router],
  );

  const maxAqiCategory =
    status?.maxAqi != null ? (status.cells[0]?.aqiCategory ?? null) : null;

  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/sources"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>Всички източници</span>
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8 border border-neutral-border">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="flex-shrink-0">
              {logoError ? (
                <div className="w-24 h-24 bg-neutral-light rounded-lg flex items-center justify-center">
                  <span className="text-2xl">🌫️</span>
                </div>
              ) : (
                <Image
                  src={`/sources/${SOURCE_ID}.png`}
                  alt="sensor.community"
                  width={96}
                  height={96}
                  className="w-24 h-24 object-contain rounded-lg"
                  onError={() => setLogoError(true)}
                  unoptimized
                />
              )}
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1">
                Мониторинг: sensor.community
              </h1>
              <p className="text-neutral text-sm">
                Качество на въздуха в реално време · {LOCALITY}
              </p>
              <p className="text-neutral text-sm mt-2">
                EAQI (European Air Quality Index) е скала от 1 до 6, изчислена
                по алгоритъма NowCast от концентрациите на ФПЧ2.5 и ФПЧ10 за
                последните 4 часа.
              </p>
              {status && (
                <p className="text-neutral text-sm mt-1">
                  Обновено: {formatTimestamp(status.updatedAt)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statusError ? (
            <div className="col-span-2 lg:col-span-4 rounded-lg border border-error-border bg-error-light px-4 py-3 text-sm text-error">
              Грешка при зареждане на данните за качеството на въздуха
            </div>
          ) : statusLoading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Card key={i}>
                  <div className="animate-pulse">
                    <div className="h-3 bg-neutral-light rounded w-3/4 mb-3" />
                    <div className="h-8 bg-neutral-light rounded w-1/2" />
                  </div>
                </Card>
              ))}
            </>
          ) : (
            <>
              <StatCard
                label="Макс. EAQI"
                value={status?.maxAqi ?? "—"}
                sub={status?.cells[0]?.aqiLabel ?? undefined}
                valueClassName={
                  maxAqiCategory
                    ? maxAqiCategory === "good" || maxAqiCategory === "fair"
                      ? "text-success"
                      : maxAqiCategory === "moderate" ||
                          maxAqiCategory === "poor"
                        ? "text-warning"
                        : "text-error"
                    : "text-foreground"
                }
              />
              <StatCard
                label="Активни сензори"
                value={status?.readings.uniqueSensors ?? "—"}
                sub={`${status?.readings.count ?? 0} показания (24 ч.)`}
              />
              <StatCard
                label="Изпратени съобщения"
                value={status?.stats.messageCount ?? "—"}
              />
              <StatCard
                label="Изпратени известия"
                value={status?.stats.notificationCount ?? "—"}
              />
            </>
          )}
        </div>

        {/* GCS data summary */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Данни в прозореца за наблюдение
          </h2>
          <Card>
            {statusError ? (
              <p className="text-error text-sm">
                Грешка при зареждане на данните
              </p>
            ) : statusLoading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-neutral-light rounded w-1/2" />
                <div className="h-4 bg-neutral-light rounded w-2/3" />
                <div className="h-4 bg-neutral-light rounded w-1/3" />
              </div>
            ) : status ? (
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <dt className="text-sm text-neutral">Статус</dt>
                  <dd className="mt-1">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${
                        status.readings.isStale
                          ? "bg-warning-light text-warning"
                          : "bg-success-light text-success"
                      }`}
                    >
                      {status.readings.isStale
                        ? "Остарели данни"
                        : "Актуални данни"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-neutral">Последно показание</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">
                    {formatTimestamp(status.readings.newestAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-neutral">Най-старо показание</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">
                    {formatTimestamp(status.readings.oldestAt)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-neutral text-sm">Няма налични данни</p>
            )}
          </Card>
        </div>

        {/* Grid cells map */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">
            EAQI по мрежови клетки (последни 4 ч.)
          </h2>
          {statusError ? (
            <p className="text-error text-sm">
              Грешка при зареждане на данните
            </p>
          ) : status && status.cells.length > 0 ? (
            <>
              <AirQualityMap cells={status.cells} locality={LOCALITY} />
              {/* Legend */}
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral">
                {[
                  { label: "Добро (1–2)", cat: "good" },
                  { label: "Задоволително (2–3)", cat: "fair" },
                  { label: "Умерено (3–4)", cat: "moderate" },
                  { label: "Лошо (4–5)", cat: "poor" },
                  { label: "Много лошо (5–6)", cat: "very-poor" },
                  { label: "Изключително лошо (6)", cat: "extremely-poor" },
                ].map(({ label, cat }) => (
                  <span
                    key={cat}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${aqiCategoryClasses(cat)}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            !statusLoading && (
              <p className="text-neutral text-sm">
                Няма налични данни за последните 4 ч.
              </p>
            )
          )}
        </div>

        {/* Recent alerts */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Последни сигнали
          </h2>
          {messagesError ? (
            <div className="rounded-lg border border-error-border bg-error-light px-4 py-3 text-sm text-error">
              Грешка при зареждане на сигналите
            </div>
          ) : (
            <MessagesGrid
              messages={messages}
              isLoading={messagesLoading}
              onMessageClick={handleMessageClick}
              limit={12}
            />
          )}
        </div>
      </div>

      <MessageDetailView
        message={selectedMessage}
        onClose={handleCloseDetail}
        onAddressClick={handleAddressClick}
      />
    </div>
  );
}

export default function AirQualityPage() {
  return (
    <Suspense>
      <AirQualityPageContent />
    </Suspense>
  );
}
