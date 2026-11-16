export const pointGeometry = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [23.32, 42.7] }, properties: {} }] };

export function toploHtml(ids = ["item-1"], fromDate = "2026-10-04T08:00:00.000Z") {
  const incidents = ids.map((id) => {
    const info = {
      AccidentId: id,
      ContentItemId: id,
      Name: "Ремонт",
      Addresses: "ул. Тест",
      GeolocationSerialized: "",
      Type: 1,
      Status: 1,
      FromDate: fromDate,
      UntilDate: null,
      AffectedService: null,
      Region: "Sofia",
      Locally: false,
      CreatedOn: fromDate,
    };

    return `
    var geoJsonString = '${JSON.stringify(pointGeometry.features)}'
    var info = ${JSON.stringify(info)}
    if (geoJsonString) { }
  `;
  }).join("\n");
  const rows = ids.map((id) => {
    return `<li class="accident-container" data-accidentId="${id}"></li>`;
  }).join("\n");

  return `<html><body>
    <div class="accident-list-homepage"><ul>${rows}</ul></div>
    <div id="accidentMap"></div>
    <script>function parseAll() { ${incidents} }</script>
  </body></html>`;
}
