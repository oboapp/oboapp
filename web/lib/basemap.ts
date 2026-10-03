/** Shared Leaflet basemap configuration. Public keys are embedded at build time. */
export function getBasemapConfig() {
  const key = process.env.NEXT_PUBLIC_CARTO_BASEMAP_API_KEY?.trim();
  const osmAttribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  if (key) {
    return {
      url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`,
      options: {
        attribution: `${osmAttribution} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
        subdomains: "abcd",
      },
    };
  }

  return {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: { attribution: osmAttribution },
  };
}
