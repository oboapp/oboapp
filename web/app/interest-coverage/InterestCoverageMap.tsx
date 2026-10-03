"use client";

import { useEffect, useRef, useState } from "react";
import { getBoundsForLocality } from "@oboapp/shared";
import type { InterestCoverageReport } from "@oboapp/shared";
import { colors } from "@/lib/colors";
import { getBasemapConfig } from "@/lib/basemap";

function bandColor(min: number) {
  if (min >= 50) return colors.primary.red;
  if (min >= 20) return colors.zones.orange;
  return colors.primary.blue;
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
      const bounds = getBoundsForLocality(report.locality);
      map = L.map(container.current, { minZoom: 10, maxZoom: 12, scrollWheelZoom: false });
      map.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]]);
      const basemap = getBasemapConfig();
      L.tileLayer(basemap.url, {
        ...basemap.options,
        maxZoom: 12,
      }).addTo(map);
      for (const cell of report.cells) {
        L.rectangle([[cell.south, cell.west], [cell.north, cell.east]], {
          color: colors.map.stroke, weight: 1, fillColor: bandColor(cell.users.min), fillOpacity: 0.55,
          interactive: false,
        }).addTo(map);
      }
    }
    void init().catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; map?.remove(); };
  }, [report]);
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-error">Картата не може да се зареди.</p>}
      <div ref={container} role="img" aria-label="Обобщено покритие на запазените зони в клетки от около 2 км" className="h-[500px] w-full rounded-md" />
      <ul aria-label="Легенда: потребители с публикувано покритие в клетка" className="flex flex-wrap gap-5 text-sm text-neutral">
        {[{ min: 10, label: "10–19" }, { min: 20, label: "20–49" }, { min: 50, label: "50+" }].map((band) => <li key={band.min} className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: bandColor(band.min) }} />{band.label} потребители</li>)}
        <li>Без цвят: липсващо или скрито покритие</li>
      </ul>
    </div>
  );
}
