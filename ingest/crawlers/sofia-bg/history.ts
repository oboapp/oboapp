import type { OboDb } from "@oboapp/db";
import type { DiscoveredItem } from "@oboapp/source-sdk";
import { articleUrlKey } from "@oboapp/source-sofia-bg";

function titleKey(title: string): string {
  return title.normalize("NFKC").replaceAll(/\s+/g, " ").trim();
}

function listingTitle(item: DiscoveredItem): string {
  const data = item.payload;
  if (
    !data || typeof data !== "object" || !("title" in data) ||
    typeof data.title !== "string" || !data.title.trim()
  ) {
    throw new Error("Missing Sofia discovery title");
  }
  return data.title;
}

export async function loadSofiaHistory(db: OboDb) {
  const records = await db.sources.findMany({
    where: [{ field: "sourceType", op: "==", value: "sofia-bg" }],
    select: ["title", "listingTitle", "url"],
  });
  const urls = new Set<string>();
  const titles = new Set<string>();
  for (const record of records) {
    if (typeof record.url === "string") {
      urls.add(articleUrlKey(record.url));
    }
    for (const title of [record.title, record.listingTitle]) {
      if (typeof title === "string" && title.trim()) {
        titles.add(titleKey(title));
      }
    }
  }
  function isKnownArticle(url: string, title: string): boolean {
    return urls.has(articleUrlKey(url)) || titles.has(titleKey(title));
  }

  const lookupErrors: unknown[] = [];
  return {
    isKnownArticle,
    lookupErrors,
    listingTitle,
    async isKnown(item: DiscoveredItem, lookupIdentifier: () => Promise<boolean>) {
      try {
        return isKnownArticle(item.identifier, listingTitle(item)) || await lookupIdentifier();
      } catch (error) {
        lookupErrors.push(error);
        throw error;
      }
    },
    remember(item: DiscoveredItem) {
      urls.add(articleUrlKey(item.identifier));
      titles.add(titleKey(listingTitle(item)));
    },
  };
}
