"use client";

import { useEffect, useRef, useState } from "react";
import { colors } from "@/lib/colors";

type HeatmapPoint = [number, number];

// Augment leaflet module with the heatLayer function from leaflet.heat plugin
declare module "leaflet" {
  export function heatLayer(
    points: HeatmapPoint[],
    options: Record<string, unknown>,
  ): import("leaflet").Layer;
}

interface HeatmapResponse {
  points: HeatmapPoint[];
  messageCount: number;
  oldestDate: string | null;
}

export interface HeatmapStats {
  messageCount: number;
  oldestDate: string | null;
}

export interface HistoryMapClientProps {
  readonly categories?: Set<string>;
  readonly sources?: Set<string>;
  readonly onStatsLoaded?: (stats: HeatmapStats) => void;
}

const SOFIA_CENTER: [number, number] = [42.6977, 23.3219];
const DEFAULT_ZOOM = 13;

// Heatmap gradient using theme colors: cool → warm → hot
const HEATMAP_GRADIENT = {
  0.4: colors.zones.blue,
  0.65: colors.semantic.warning,
  1: colors.semantic.error,
};

async function fetchHeatmapData(
  categories?: Set<string>,
  sources?: Set<string>,
): Promise<HeatmapResponse> {
  const params = new URLSearchParams();
  if (categories && categories.size > 0) {
    params.set("categories", Array.from(categories).join(","));
  }
  if (sources && sources.size > 0) {
    params.set("sources", Array.from(sources).join(","));
  }
  const qs = params.toString();
  const url = `/api/messages/heatmap${qs ? `?${qs}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch heatmap data");
  }
  const data: HeatmapResponse = await response.json();
  return data;
}

export default function HistoryMapClient({
  categories,
  sources,
  onStatsLoaded,
}: HistoryMapClientProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const heatLayerRef = useRef<import("leaflet").Layer | null>(null);
  // Store L (leaflet namespace) for use across effects.
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pointCount, setPointCount] = useState(0);

  // Keep a stable ref to the callback so the data-fetching effect doesn't
  // need to list it as a dependency (avoids spurious re-fetches).
  const onStatsLoadedRef = useRef(onStatsLoaded);
  onStatsLoadedRef.current = onStatsLoaded;

  // ── Map initialisation (runs once) ──────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;

    async function initMap() {
      try {
        // @types/leaflet uses `export =`, so the dynamic import gives us a
        // module with a `.default` property at runtime (via the bundler).
        // Access it through the module object to stay type-safe.
        const leafletModule = await import("leaflet");
        const L: typeof import("leaflet") =
          "default" in leafletModule ? leafletModule.default : leafletModule;
        await import("leaflet.heat");

        if (cancelled || !mapRef.current || mapInstanceRef.current) return;

        leafletRef.current = L;

        const map = L.map(mapRef.current, {
          center: SOFIA_CENTER,
          zoom: DEFAULT_ZOOM,
          zoomControl: true,
          minZoom: 10,
          maxZoom: 15,
        });
        mapInstanceRef.current = map;

        // CartoDB Positron: a clean, desaturated base map (no API key required)
        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            minZoom: 10,
            maxZoom: 15,
            subdomains: "abcd",
          },
        ).addTo(map);

        if (!cancelled) setIsMapReady(true);
      } catch (err) {
        if (!cancelled) {
          console.error("Error initializing map:", err);
          setError("Грешка при зареждане на картата");
          setIsLoading(false);
        }
      }
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        leafletRef.current = null;
      }
    };
  }, []);

  // ── Data fetching (re-runs whenever filters change or map becomes ready) ─
  useEffect(() => {
    if (!isMapReady) return;

    let cancelled = false;

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        // Remove the previous heat layer before fetching new data
        if (heatLayerRef.current && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(heatLayerRef.current);
          heatLayerRef.current = null;
        }

        const data = await fetchHeatmapData(categories, sources);
        if (cancelled) return;

        setPointCount(data.points.length);
        onStatsLoadedRef.current?.({
          messageCount: data.messageCount,
          oldestDate: data.oldestDate,
        });

        if (
          data.points.length > 0 &&
          mapInstanceRef.current &&
          leafletRef.current
        ) {
          const L = leafletRef.current;
          const layer = L
            .heatLayer(data.points, {
              radius: 20,
              blur: 25,
              maxZoom: 17,
              gradient: HEATMAP_GRADIENT,
            })
            .addTo(mapInstanceRef.current);
          heatLayerRef.current = layer;
        }

        if (!cancelled) setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("Error loading heatmap data:", err);
          setError("Грешка при зареждане на картата");
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [isMapReady, categories, sources]);

  return (
    <div className="relative w-full h-full min-h-[500px]">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-light">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-neutral">Зареждане на данните...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-light">
          <div className="rounded-md border border-error-border bg-error-light p-4 text-error text-sm">
            {error}
          </div>
        </div>
      )}

      <div ref={mapRef} className="w-full h-full min-h-[500px]" />

      {!isLoading && !error && pointCount > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[400] pointer-events-none">
          <div className="bg-white/90 rounded-lg px-3 py-1.5 shadow text-xs text-neutral border border-neutral-border">
            {pointCount.toLocaleString("bg-BG")} точки от исторически данни
          </div>
        </div>
      )}
    </div>
  );
}
