# nadezhda-org crawler

Crawls announcements from Sofia district Nadezhda.

- Source page: https://nadezhda.sofia.bg/%D0%BE%D0%B1%D1%8F%D0%B2%D0%B8-%D0%B8-%D1%81%D1%8A%D0%BE%D0%B1%D1%89%D0%B5%D0%BD%D0%B8%D1%8F
- Source type: `nadezhda-org`
- Locality: `bg.sofia`

## Notes

- Listing entries are in `li.shadow-sm` containers and link to `/news/...` detail pages.
- Detail pages provide title and date in the main body section; date format is typically `DD/MM/YYYY`.
- This is a long-flow crawler: it stores source documents only, then the ingest pipeline handles categorization, location extraction, and GeoJSON generation.
