"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  GoogleMap,
  Marker,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";
import { getButtonClasses } from "@/lib/theme";
import { zIndex } from "@/lib/colors";
import { getLocalityCenter } from "@/lib/bounds-utils";

interface FrequencyEntry {
  key: string;
  originalText: string;
  count: number;
  cached: boolean;
  messageIds: string[];
  partial?: boolean;
}

interface Report {
  generatedAt: string;
  messagesAnalyzed: number;
  pins: FrequencyEntry[];
  streets: FrequencyEntry[];
}

interface PinGeometryItem {
  messageId: string;
  lat: number;
  lng: number;
  formattedAddress: string;
}

interface StreetGeometryItem {
  messageId: string;
  coordinates: { lat: number; lng: number }[][];
}

type GeometryData =
  | { type: "pin"; items: PinGeometryItem[] }
  | { type: "street"; items: StreetGeometryItem[] };

const MAP_CONTAINER_STYLE = { width: "100%", height: "360px" };
const MAP_CENTER = getLocalityCenter();
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ saturation: -60 }] },
  {
    elementType: "labels.text.fill",
    stylers: [{ saturation: -40 }, { lightness: 10 }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ visibility: "on" }, { saturation: -100 }, { lightness: 60 }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ saturation: -100 }, { lightness: 40 }],
  },
  {
    featureType: "poi",
    elementType: "labels.icon",
    stylers: [{ saturation: -100 }, { lightness: 20 }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ saturation: -100 }, { lightness: 20 }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ saturation: -60 }, { lightness: 20 }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ saturation: -40 }, { lightness: 30 }],
  },
];
const MAP_OPTIONS: google.maps.MapOptions = {
  streetViewControl: false,
  fullscreenControl: false,
  mapTypeControl: false,
  zoomControl: true,
  clickableIcons: false,
  styles: MAP_STYLES,
};

// Distinct colors for up to 20 source messages
const COLORS = [
  "#3B82F6",
  "#EF4444",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
  "#F97316",
  "#6366F1",
  "#14B8A6",
  "#F43F5E",
  "#A855F7",
  "#22C55E",
  "#EAB308",
  "#0EA5E9",
  "#D946EF",
  "#64748B",
  "#E11D48",
  "#7C3AED",
];

function GeometryMap({
  data,
  mapRef,
}: {
  data: GeometryData | null;
  mapRef: React.MutableRefObject<google.maps.Map | null>;
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
    preventGoogleFontsLoading: true,
  });

  if (loadError) {
    return (
      <div className="h-[360px] flex items-center justify-center bg-neutral-light">
        <p className="text-sm text-destructive">Картата не е достъпна</p>
      </div>
    );
  }

  if (!isLoaded) {
    return <div className="h-[360px] bg-neutral-border animate-pulse" />;
  }

  return (
    <GoogleMap
      mapContainerStyle={MAP_CONTAINER_STYLE}
      center={MAP_CENTER}
      zoom={14}
      options={MAP_OPTIONS}
      onLoad={(map) => {
        mapRef.current = map;
      }}
    >
      {data?.type === "pin" &&
        data.items.map((item, i) => (
          <Marker
            key={item.messageId}
            position={{ lat: item.lat, lng: item.lng }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: COLORS[i % COLORS.length],
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 2,
            }}
            title={`${item.formattedAddress} (${item.messageId})`}
          />
        ))}
      {data?.type === "street" &&
        data.items.flatMap((item, i) =>
          item.coordinates.map((line, j) => (
            <Polyline
              key={`${item.messageId}-${j}`}
              path={line}
              options={{
                strokeColor: COLORS[i % COLORS.length],
                strokeWeight: 4,
                strokeOpacity: 0.85,
              }}
            />
          )),
        )}
    </GoogleMap>
  );
}

function GeometryPanel({
  entry,
  type,
  onClose,
}: {
  entry: FrequencyEntry;
  type: "pin" | "street";
  onClose: () => void;
}) {
  const [data, setData] = useState<GeometryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  // Component is keyed on entry+type in parent, so it remounts on change.
  // No synchronous setState needed here — initial state covers the reset.
  useEffect(() => {
    const limitedMessageIds = entry.messageIds.slice(0, 20);
    const params = new URLSearchParams({
      type,
      key: entry.key,
      messageIds: limitedMessageIds.join(","),
    });

    void fetch(`/api/geocode-cache/geometries?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Грешка ${r.status}`);
        const json = await r.json();
        if (type === "pin") {
          const items: PinGeometryItem[] = json.items;
          setData({ type: "pin", items });
        } else {
          const items: StreetGeometryItem[] = json.items;
          setData({ type: "street", items });
        }
      })
      .catch((e: unknown) => {
        setFetchError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [entry, type]);

  // Fit map bounds once data is loaded
  useEffect(() => {
    if (!mapRef.current || !data) return;
    const bounds = new google.maps.LatLngBounds();
    if (data.type === "pin") {
      data.items.forEach((item) =>
        bounds.extend({ lat: item.lat, lng: item.lng }),
      );
    } else {
      data.items.forEach((item) =>
        item.coordinates.forEach((line) =>
          line.forEach((pt) => bounds.extend(pt)),
        ),
      );
    }
    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, 60);
    }
  }, [data]);

  return (
    <div
      className={`fixed right-0 top-0 bottom-0 w-full sm:w-[480px] ${zIndex.overlayContent} bg-white shadow-2xl flex flex-col`}
    >
      <div className="flex items-start justify-between px-4 py-3 border-b border-neutral-border">
        <div className="min-w-0">
          <p className="text-xs text-neutral uppercase tracking-wide mb-0.5">
            {type === "pin" ? "Адрес (пин)" : "Улица"}
          </p>
          <p className="text-lg font-semibold text-foreground truncate">
            {entry.originalText}
          </p>
          <p className="text-sm text-neutral mt-0.5">
            {entry.count}× в {entry.messageIds.length} съобщени
            {entry.messageIds.length === 1 ? "е" : "я"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-3 mt-0.5 shrink-0 text-foreground hover:text-neutral transition-colors cursor-pointer"
          aria-label="Затвори"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="border-b border-neutral-border">
        {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
          <GeometryMap data={data} mapRef={mapRef} />
        ) : (
          <div className="h-[360px] flex items-center justify-center bg-neutral-light">
            <p className="text-sm text-neutral/60">
              Картата не е налична (липсва API ключ)
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && <p className="text-base text-neutral">Зарежда се...</p>}
        {fetchError && (
          <p className="text-base text-destructive">{fetchError}</p>
        )}
        {!loading && !fetchError && data && data.items.length === 0 && (
          <p className="text-base text-neutral">
            Няма запазена геометрия в тези съобщения. Вероятно са по-стари от
            функционалността с кеширане.
          </p>
        )}
        {!loading && !fetchError && data && data.items.length > 0 && (
          <ul className="space-y-2">
            {data.type === "pin"
              ? data.items.map((item, i) => (
                  <li key={item.messageId} className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full shrink-0"
                      style={{ background: COLORS[i % COLORS.length] }}
                    />
                    <a
                      href={`/m/${item.messageId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-info hover:underline font-mono shrink-0"
                    >
                      {item.messageId}
                    </a>
                    <span className="text-neutral truncate flex-1">
                      {item.formattedAddress}
                    </span>
                    {!entry.cached && (
                      <CopyCommand
                        entry={entry}
                        messageId={item.messageId}
                        type={type}
                      />
                    )}
                  </li>
                ))
              : data.items.map((item, i) => (
                  <li key={item.messageId} className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full shrink-0"
                      style={{ background: COLORS[i % COLORS.length] }}
                    />
                    <a
                      href={`/m/${item.messageId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-info hover:underline font-mono shrink-0"
                    >
                      {item.messageId}
                    </a>
                    <span className="text-neutral shrink-0">
                      {item.coordinates.length} сегмент
                      {item.coordinates.length !== 1 ? "а" : ""}
                    </span>
                    {!entry.cached && (
                      <CopyCommand
                        entry={entry}
                        messageId={item.messageId}
                        type={type}
                      />
                    )}
                  </li>
                ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CopyCommandButton({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={cmd}
      className="shrink-0 flex items-center gap-1 text-neutral hover:text-info transition-colors text-sm font-mono"
    >
      <span>{label}</span>
      <span>{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

function CopyCommand({
  entry,
  messageId,
  type,
}: {
  entry: FrequencyEntry;
  messageId: string;
  type: "pin" | "street";
}) {
  const addCmd = `pnpm geocode-cache:add --message ${messageId} --address "${entry.originalText}" --type ${type}`;
  const geocodeCmd = `pnpm geocode-cache:geocode --street "${entry.originalText}" --query "${entry.originalText}" --message ${messageId}`;

  if (type === "street") {
    return (
      <span className="shrink-0 flex items-center gap-1 text-sm font-mono">
        <span className="text-neutral">cache:</span>
        <CopyCommandButton label="add" cmd={addCmd} />
        <CopyCommandButton label="geocode" cmd={geocodeCmd} />
      </span>
    );
  }

  return <CopyCommandButton label="cache:add" cmd={addCmd} />;
}

function FrequencyTable({
  title,
  entries,
  type,
  showAll,
  selectedKey,
  onSelect,
}: {
  title: string;
  entries: FrequencyEntry[];
  type: "pin" | "street";
  showAll: boolean;
  selectedKey: string | null;
  onSelect: (entry: FrequencyEntry, type: "pin" | "street") => void;
}) {
  const shown = showAll ? entries : entries.slice(0, 50);
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-neutral mb-3">{title}</h2>
      <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-neutral-border">
        <table className="w-full text-sm">
          <thead className="bg-neutral-light text-neutral text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Адрес</th>
              <th className="px-3 py-2 font-medium w-20 text-right">Брой</th>
              <th className="px-3 py-2 font-medium w-24 text-center">
                Кеширан
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr
                key={e.key}
                className={`border-t border-neutral-border cursor-pointer transition-colors ${
                  selectedKey === e.key
                    ? "bg-info-light"
                    : "hover:bg-neutral-light/50"
                }`}
                onClick={() => onSelect(e, type)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onSelect(e, type);
                  }
                }}
                tabIndex={0}
                role="button"
              >
                <td className="px-3 py-2">
                  <span className="text-neutral">{e.originalText}</span>
                  <span className="ml-2 text-xs text-neutral/50">{e.key}</span>
                  {e.partial && (
                    <span className="ml-2 text-xs font-medium text-warning bg-warning-light px-1.5 py-0.5 rounded">
                      в процес
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{e.count}</td>
                <td className="px-3 py-2 text-center">
                  {e.cached ? (
                    <span className="text-success text-xs font-medium">
                      ✓ Да
                    </span>
                  ) : (
                    <span className="text-destructive text-xs font-medium">
                      ✗ Не
                    </span>
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

export default function GeocodeCacheClient() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filterUncached, setFilterUncached] = useState(false);
  const [selected, setSelected] = useState<{
    entry: FrequencyEntry;
    type: "pin" | "street";
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/geocode-cache/report");
        if (r.status === 404) {
          setError("not-generated");
          return;
        }
        if (r.status === 503) {
          setError("bucket-missing");
          return;
        }
        if (!r.ok) throw new Error(`Грешка ${r.status}`);
        const data: Report = await r.json();
        setReport(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (
    error === "not-generated" ||
    error === "bucket-missing" ||
    error ||
    !report
  ) {
    return (
      <div className="min-h-screen bg-neutral-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-6">
            <Link
              href="/sources"
              className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
            >
              <span>←</span>
              <span>Източници</span>
            </Link>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6 border border-neutral-border">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
              Кеш на геокодирането
            </h1>
            {error === "not-generated" && (
              <>
                <p className="text-sm text-neutral mb-3">
                  Отчетът още не е генериран. Виж{" "}
                  <a
                    href="https://github.com/oboapp/oboapp/blob/main/docs/features/geocode-cache.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    документацията
                  </a>{" "}
                  за инструкции как да го генерираш.
                </p>
              </>
            )}
            {error === "bucket-missing" && (
              <p className="text-sm text-destructive">
                Хранилището GCS не е конфигурирано (липсва GCS_GENERIC_BUCKET).
              </p>
            )}
            {error &&
              error !== "not-generated" &&
              error !== "bucket-missing" && (
                <div className="rounded-md border border-error-border bg-error-light p-4 text-error text-sm">
                  {error}
                </div>
              )}
            {!error && !report && (
              <p className="text-sm text-neutral/60">Зарежда се...</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const pins = report.pins
    .filter((p) => p.count > 1 || p.partial)
    .filter((p) => !filterUncached || !p.cached);
  const streets = report.streets
    .filter((s) => s.count > 1 || s.partial)
    .filter((s) => !filterUncached || !s.cached);

  const cachedPinCount = report.pins.filter((p) => p.cached).length;
  const cachedStreetCount = report.streets.filter((s) => s.cached).length;

  const handleSelect = (entry: FrequencyEntry, type: "pin" | "street") => {
    setSelected((prev) =>
      prev?.entry.key === entry.key && prev.type === type
        ? null
        : { entry, type },
    );
  };

  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-6">
          <Link
            href="/sources"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>Източници</span>
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8 border border-neutral-border">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1">
            Кеш на геокодирането
          </h1>
          <p className="text-sm text-neutral/60 mb-6">
            Генериран: {new Date(report.generatedAt).toLocaleString("bg-BG")} ·{" "}
            Анализирани съобщения:{" "}
            {report.messagesAnalyzed.toLocaleString("bg-BG")}
          </p>

          <div className="flex flex-wrap gap-6 mb-6 text-sm">
            <div>
              <span className="font-semibold">{cachedStreetCount}</span>
              <span className="text-neutral/60">
                {" "}
                / {report.streets.length} улици кеширани
              </span>
            </div>
            <div>
              <span className="font-semibold">{cachedPinCount}</span>
              <span className="text-neutral/60">
                {" "}
                / {report.pins.length} адреса кеширани
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={getButtonClasses(
                filterUncached ? "secondary" : "ghost",
                "sm",
              )}
              onClick={() => setFilterUncached((v) => !v)}
            >
              {filterUncached ? "✓ Само некеширани" : "Само некеширани"}
            </button>
            <div className="flex rounded-md border border-neutral-border overflow-hidden text-sm">
              <button
                type="button"
                className={`px-3 py-1.5 transition-colors cursor-pointer ${
                  !showAll
                    ? "bg-primary text-white"
                    : "bg-white text-neutral hover:bg-neutral-light"
                }`}
                onClick={() => setShowAll(false)}
              >
                Топ 50
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 transition-colors cursor-pointer border-l border-neutral-border ${
                  showAll
                    ? "bg-primary text-white"
                    : "bg-white text-neutral hover:bg-neutral-light"
                }`}
                onClick={() => setShowAll(true)}
              >
                Всички
              </button>
            </div>
          </div>
        </div>

        <FrequencyTable
          title={`Улици — ${streets.length}`}
          entries={streets}
          type="street"
          showAll={showAll}
          selectedKey={selected?.type === "street" ? selected.entry.key : null}
          onSelect={handleSelect}
        />
        <FrequencyTable
          title={`Адреси (пинове) — ${pins.length}`}
          entries={pins}
          type="pin"
          showAll={showAll}
          selectedKey={selected?.type === "pin" ? selected.entry.key : null}
          onSelect={handleSelect}
        />

        {selected && (
          <>
            <button
              type="button"
              aria-label="Затвори панела"
              className={`fixed inset-0 ${zIndex.overlay} bg-black/20 sm:hidden`}
              onClick={() => setSelected(null)}
            />
            <GeometryPanel
              key={`${selected.entry.key}-${selected.type}`}
              entry={selected.entry}
              type={selected.type}
              onClose={() => setSelected(null)}
            />
          </>
        )}
      </div>
    </div>
  );
}
