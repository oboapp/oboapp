"use client";

import { useEffect, useRef, useState } from "react";
import { colors } from "@/lib/colors";

export interface AirQualityCell {
  id: string;
  aqi: number | null;
  aqiLabel: string | null;
  aqiCategory: string | null;
  sensorCount: number;
  bounds: { south: number; north: number; west: number; east: number } | null;
}

interface AirQualityMapProps {
  readonly cells: AirQualityCell[];
  readonly locality: string;
}

// EAQI category → fill color (semi-transparent) and stroke
const CATEGORY_COLORS: Record<string, { fill: string; stroke: string }> = {
  good: { fill: colors.semantic.successLight, stroke: colors.semantic.success },
  fair: { fill: colors.semantic.successLight, stroke: colors.semantic.success },
  moderate: { fill: colors.semantic.warningLight, stroke: colors.semantic.warning },
  poor: { fill: colors.semantic.warningLight, stroke: colors.semantic.warning },
  "very-poor": { fill: colors.semantic.errorLight, stroke: colors.semantic.error },
  "extremely-poor": { fill: colors.semantic.errorLight, stroke: colors.semantic.error },
};

const SOFIA_CENTER: [number, number] = [42.6977, 23.3219];
const DEFAULT_ZOOM = 11;

export default function AirQualityMap({ cells, locality: _locality }: AirQualityMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const rectangleLayersRef = useRef<import("leaflet").Rectangle[]>([]);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const hasFitBoundsRef = useRef(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Map initialisation (runs once) ──────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;

    async function initMap() {
      try {
        const leafletModule = await import("leaflet");
        const L: typeof import("leaflet") =
          "default" in leafletModule ? leafletModule.default : leafletModule;

        if (cancelled || !mapRef.current || mapInstanceRef.current) return;

        leafletRef.current = L;

        const map = L.map(mapRef.current, {
          center: SOFIA_CENTER,
          zoom: DEFAULT_ZOOM,
          zoomControl: true,
        });
        mapInstanceRef.current = map;

        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: "abcd",
            maxZoom: 19,
          },
        ).addTo(map);

        if (!cancelled) setIsMapReady(true);
      } catch (err) {
        if (!cancelled) {
          console.error("Error initializing air quality map:", err);
          setError("Грешка при зареждане на картата");
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
        rectangleLayersRef.current = [];
        hasFitBoundsRef.current = false;
      }
    };
  }, []);

  // ── Draw / update cell rectangles whenever cells or map readiness changes ─
  useEffect(() => {
    if (!isMapReady || !mapInstanceRef.current || !leafletRef.current) return;

    const L = leafletRef.current;
    const map = mapInstanceRef.current;

    // Remove previous rectangles
    for (const rect of rectangleLayersRef.current) {
      map.removeLayer(rect);
    }
    rectangleLayersRef.current = [];

    const cellsWithBounds = cells.filter((c) => c.bounds !== null);

    for (const cell of cellsWithBounds) {
      const { south, north, west, east } = cell.bounds!;
      const cellStyle = (cell.aqiCategory !== null ? CATEGORY_COLORS[cell.aqiCategory] : undefined) ?? {
        fill: "#E5E7EB",
        stroke: "#9CA3AF",
      };

      const rect = L.rectangle(
        [
          [south, west],
          [north, east],
        ],
        {
          color: cellStyle.stroke,
          weight: 1.5,
          fillColor: cellStyle.fill,
          fillOpacity: 0.55,
        },
      );

      rect.bindTooltip(
        `EAQI: ${cell.aqi !== null ? cell.aqi.toFixed(1) : "—"} — ${cell.aqiLabel ?? "—"}<br/>Сензори: ${cell.sensorCount}`,
        { sticky: true },
      );

      rect.addTo(map);
      rectangleLayersRef.current.push(rect);
    }

    // Fit map to bounds of all drawn cells on first draw only, to avoid
    // resetting user zoom/pan on periodic refetches
    if (cellsWithBounds.length > 0 && !hasFitBoundsRef.current) {
      const allBounds = cellsWithBounds.map((c) => c.bounds!);
      const south = Math.min(...allBounds.map((b) => b.south));
      const north = Math.max(...allBounds.map((b) => b.north));
      const west = Math.min(...allBounds.map((b) => b.west));
      const east = Math.max(...allBounds.map((b) => b.east));
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { padding: [20, 20] },
      );
      hasFitBoundsRef.current = true;
    }
  }, [isMapReady, cells]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-80 rounded-lg border border-error-border bg-error-light">
        <p className="text-error text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-neutral-border shadow-md h-80 sm:h-96">
      {!isMapReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-light">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-neutral">Зареждане на картата...</p>
          </div>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}
