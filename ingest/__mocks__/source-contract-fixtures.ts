import type { WeatherPageData } from "@/crawlers/nimh-severe-weather/types";

export const pointGeometry = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [23.32, 42.7] }, properties: {} }] };

export function toploHtml(ids = ["item-1"], fromDate = "2026-10-04T08:00:00.000Z") {
  const incidents = ids.map((id) => `
    var geoJsonString = '${JSON.stringify(pointGeometry.features)}'
    var info = ${JSON.stringify({ AccidentId: id, ContentItemId: id, Name: "Ремонт", Addresses: "ул. Тест", GeolocationSerialized: "", Type: 1, Status: 1, FromDate: fromDate, UntilDate: null, AffectedService: null, Region: "Sofia", Locally: false, CreatedOn: fromDate })}
    if (geoJsonString) { }
  `).join("\n");
  return `<html><script>function parseAll() { ${incidents} }</script></html>`;
}

export const weatherWarning: WeatherPageData = {
  forecastDate: "2026-10-04", issuedAt: "2026-10-04T08:00:00.000Z", recommendation: "Силен вятър",
  sofiaWarnings: [{ type: "wind", level: "yellow", notes: ["Силен вятър"] }],
};
