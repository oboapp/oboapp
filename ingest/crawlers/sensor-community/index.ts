import { getBoundsForLocality } from "@oboapp/shared";
import { createSource } from "@oboapp/source-sensor-community";
import { metadata } from "@oboapp/source-sensor-community/metadata";
import { createSourceCrawler } from "@/sources/create-source-crawler";

export const crawl = createSourceCrawler(metadata, async (context) => {
  const { createReadingsStore } = await import("@/lib/air-quality/readings-store");
  const store = createReadingsStore();
  return createSource(context, {
    bounds: getBoundsForLocality(context.locality),
    readReadings(locality, start, end) {
      return store.getReadingsInRange(locality, start, end);
    },
  });
});
