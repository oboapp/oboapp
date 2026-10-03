"use client";

import { useEffect, useRef, useState } from "react";
import { getBoundsForLocality, getCenterForLocality } from "@oboapp/shared";
import type { InterestCoverageReport } from "@oboapp/shared";
import { getBasemapConfig } from "@/lib/basemap";
import { HEATMAP_GRADIENT } from "@/lib/heatmap";
import { COVERAGE_SAMPLES_PER_AXIS, makeCoverageHeatPoints } from "@/lib/interest-coverage-heatmap";

export default function InterestCoverageMap({ report }: { readonly report: InterestCoverageReport }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    async function init() {
      const leafletModule = await import("leaflet");
      const L = "default" in leafletModule ? leafletModule.default : leafletModule;
      await import("leaflet.heat");
      if (cancelled || !container.current) return;
      const bounds = getBoundsForLocality(report.locality);
      const center = getCenterForLocality(report.locality);
      const activeMap = L.map(container.current, { minZoom: 10, maxZoom: 15 });
      map = activeMap;
      activeMap.setView([center.lat, center.lng], 13);
      const basemap = getBasemapConfig();
      L.tileLayer(basemap.url, { ...basemap.options, minZoom: 10, maxZoom: 15 }).addTo(activeMap);
      const points = makeCoverageHeatPoints(report);
      const layer = L.heatLayer(points, {
        maxZoom: 10,
        minOpacity: 0.1,
        gradient: HEATMAP_GRADIENT,
      });
      // Keep smoothing at the same geographic scale as zoom changes.
      // Samples cover each aggregate uniformly; they imply no finer location data.
      const updateRadius = () => {
        const latitude = (bounds.south + bounds.north) / 2;
        const longitude = (bounds.west + bounds.east) / 2;
        const sampleDegrees = report.gridMeters / 111320 / COVERAGE_SAMPLES_PER_AXIS;
        const spacing = activeMap.latLngToLayerPoint([latitude, longitude]).distanceTo(
          activeMap.latLngToLayerPoint([latitude + sampleDegrees, longitude]),
        );
        layer.setOptions({ radius: Math.max(2, spacing / 2), blur: Math.max(3, spacing) });
      };
      updateRadius();
      layer.addTo(activeMap);
      activeMap.on("zoomend", updateRadius);
    }
    void init().catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; map?.remove(); };
  }, [report]);
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-error">Картата не може да се зареди.</p>}
      <div ref={container} role="img" aria-label="Топлинна карта на обобщеното покритие на запазените зони" className="h-[500px] w-full rounded-md" />
      <div aria-label="Легенда: относителна плътност на публикуваното покритие" className="flex flex-wrap items-center gap-3 text-sm text-neutral">
        <span>По-ниска плътност</span>
        <span aria-hidden="true" className="h-3 w-32 rounded-full" style={{ background: `linear-gradient(to right, ${HEATMAP_GRADIENT[0.4]}, ${HEATMAP_GRADIENT[0.65]}, ${HEATMAP_GRADIENT[1]})` }} />
        <span>По-висока плътност</span>
      </div>
      <p className="text-sm text-neutral">Цветовете показват относителна плътност в този отчет. Преливането е визуално изглаждане на обобщени клетки от около 2 км, а не точни граници на зоните. Без цвят: липсващо или скрито покритие.</p>
    </div>
  );
}
