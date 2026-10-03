"use client";

import { useEffect, useRef, useState } from "react";
import { getBoundsForLocality, getCenterForLocality, INTEREST_HEATMAP_COLORS } from "@oboapp/shared";
import type { InterestCoverageReport } from "@oboapp/shared";
import { getBasemapConfig } from "@/lib/basemap";
import { rasterizeInterestCoverage } from "@/lib/interest-coverage-heatmap";

function getHeatmapImage(report: InterestCoverageReport) {
  if (report.version === 2) {
    return report.image ? { dataUrl: report.image.dataUrl, bounds: getBoundsForLocality(report.locality) } : null;
  }
  // Temporary compatibility with the previously generated coarse snapshot.
  const raster = rasterizeInterestCoverage(report.cells);
  if (!raster) return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  const image = context.createImageData(raster.width, raster.height);
  image.data.set(raster.pixels);
  context.putImageData(image, 0, 0);
  return { dataUrl: canvas.toDataURL(), bounds: raster.bounds };
}

export default function InterestCoverageMap({ report }: { readonly report: InterestCoverageReport }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    async function init() {
      const leafletModule = await import("leaflet");
      const L = "default" in leafletModule ? leafletModule.default : leafletModule;
      if (cancelled || !container.current) return;
      const center = getCenterForLocality(report.locality);
      map = L.map(container.current, {
        center: [center.lat, center.lng], zoom: 13,
        minZoom: 10, maxZoom: 15, scrollWheelZoom: false,
      });
      const basemap = getBasemapConfig();
      L.tileLayer(basemap.url, {
        ...basemap.options,
        maxZoom: 15,
      }).addTo(map);
      const image = getHeatmapImage(report);
      if (image) {
        const { south, west, north, east } = image.bounds;
        L.imageOverlay(image.dataUrl, [[south, west], [north, east]], {
          interactive: false,
        }).on("error", () => { if (!cancelled) setError(true); })
          .on("load", () => { if (!cancelled) setError(false); }).addTo(map);
        if (report.version === 1) {
          map.fitBounds([[south, west], [north, east]], { padding: [24, 24], maxZoom: 12 });
        }
      }
    }
    void init().catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; map?.remove(); };
  }, [report]);
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-error">Картата не може да се зареди.</p>}
      <div ref={container} role="img" aria-label="Топлинна карта на интереса към известия по запазени зони" className="h-[500px] w-full rounded-md" />
      <div aria-label="Легенда: интерес към известия" className="flex flex-wrap items-center gap-3 text-sm text-neutral">
        <span>По-малко хора</span>
        <span aria-hidden="true" className="inline-block h-3 w-32 rounded-full" style={{ background: `linear-gradient(to right, ${INTEREST_HEATMAP_COLORS.join(", ")})` }} />
        <span>Повече хора</span>
      </div>
      <p className="text-sm text-neutral">По-топлите и наситени цветове показват повече хора с интерес към района. {report.version === 1 ? "Този отчет използва предишното обобщаване в райони от около 2 км." : "Зоните са леко изместени и изгладени. Самостоятелните зони и припокриванията на по-малко от трима души са скрити."} Картата не показва точни адреси или граници на зони.</p>
    </div>
  );
}
