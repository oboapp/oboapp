import type { Page } from "playwright";
import type { PostLink } from "./types";
import { parseRssFeedItems } from "../shared/rss";
export { fetchFeedXml, RSS_FEED_FETCH_TIMEOUT_MS as FEED_FETCH_TIMEOUT_MS } from "../shared/rss";

export const REPAIRS_LISTING_URL =
  "https://www.sofia.bg/bg/repairs-and-traffic-changes";

/** Extract dated article links and the next page from the current Liferay listing. */
export async function extractListingPage(page: Page, listingUrl = REPAIRS_LISTING_URL): Promise<{
  posts: PostLink[];
  nextUrl: string | null;
}> {
  return page.evaluate((baseUrl) => {
    const posts: PostLink[] = [];
    for (const titleEl of Array.from(document.querySelectorAll("#main-content .news-title"))) {
      const link = titleEl.closest("a");
      const href = link?.getAttribute("href");
      const title = titleEl.textContent?.replaceAll(/\s+/g, " ").trim();
      const dateText = link?.querySelector(".date")?.textContent?.trim() ?? "";
      const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText);
      if (!href || !title || !match) continue;
      const [, day, month, year] = match;
      const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
      ) continue;
      const url = new URL(href, baseUrl);
      if (
        url.hostname !== "www.sofia.bg" ||
        url.protocol !== "https:" ||
        !url.pathname.includes("/w/")
      ) continue;
      url.search = "";
      url.hash = "";
      posts.push({ url: url.toString(), title, date: date.toISOString() });
    }
    const next = document.querySelector("#main-content a[title='Следваща страница']")?.getAttribute("href");
    const nextUrl = next ? new URL(next, baseUrl) : null;
    return {
      posts,
      nextUrl:
        nextUrl?.hostname === "www.sofia.bg" &&
        nextUrl.protocol === "https:" &&
        nextUrl.pathname.endsWith(new URL(baseUrl).pathname.split("/").at(-1) ?? "")
          ? nextUrl.toString() : null,
    };
  }, listingUrl);
}

/** Normalize locale/guest prefixes and tracking parameters on historical article URLs. */
export function articleUrlKey(url: string): string {
  const parsed = new URL(url);
  const path = decodeURIComponent(parsed.pathname).replace(/\/$/, "");
  const articlePath = path.slice(path.indexOf("/w/"));
  return path.includes("/w/") ? `${parsed.hostname}${articlePath}` : `${parsed.hostname}${path}`;
}

export function articleTitleKey(title: string): string {
  return title.normalize("NFKC").replaceAll(/\s+/g, " ").trim();
}

const UNWANTED_ELEMENTS = [
  "script",
  "style",
  "nav",
  "header",
  "footer",
  ".share-buttons",
  ".social-share",
  ".navigation",
];

/**
 * Merge page-extracted post details with listing or RSS data.
 * The discovery date is always used (the detail page has no machine-readable date).
 * The discovery title is used as a fallback when the page extractor returns an empty
 * string (e.g. Liferay content pages where the first paragraph fragment has no
 * CMS content placed in it).
 */
export function mergePostDetails(
  extracted: { title: string; dateText: string; contentHtml: string },
  rss: { title: string; date: string },
): { title: string; dateText: string; contentHtml: string } {
  return {
    ...extracted,
    dateText: rss.date,
    title: extracted.title || rss.title,
  };
}

/**
 * Parse RSS feed XML into a list of post links.
 */
export function parseFeedItems(xml: string): PostLink[] {
  return parseRssFeedItems(xml, {
    hostname: "www.sofia.bg",
    dateTag: "dc:date",
    stripQuery: true,
  }).map((item) => ({
    url: item.url,
    title: item.title,
    date: item.date,
  }));
}

/**
 * Extract post details from an individual post page.
 * Date comes from the listing or news RSS feed.
 *
 * Handles two Liferay page layouts used by sofia.bg:
 *  - Asset publisher pages (repairs): `.asset-title` + `.asset-content`
 *  - Content pages (news): `.component-paragraph.text-break` inside `#main-content`
 */
export async function extractPostDetails(
  page: Page,
): Promise<{ title: string; dateText: string; contentHtml: string }> {
  return page.evaluate((unwanted) => {
    const unwantedSel = unwanted.join(", ");

    // Asset publisher layout (repairs): .asset-title + .asset-content
    const assetTitleEl = document.querySelector(".asset-title");
    const assetContentEl = document.querySelector(".asset-content");
    if (assetTitleEl || assetContentEl) {
      const title = assetTitleEl?.textContent?.trim() ?? "";
      const cloneNode = assetContentEl?.cloneNode(true);
      const clone = cloneNode instanceof HTMLElement ? cloneNode : null;
      if (clone && unwantedSel)
        clone.querySelectorAll(unwantedSel).forEach((el) => el.remove());
      return { title, dateText: "", contentHtml: clone?.innerHTML ?? "" };
    }

    // Content page layout (news): .component-paragraph.text-break inside #main-content
    const paragraphs = Array.from(
      document.querySelectorAll(
        "#main-content .component-paragraph.text-break",
      ),
    );
    const title = paragraphs[0]?.textContent?.trim() ?? "";
    const contentHtml = paragraphs
      .slice(1)
      .map((el) => {
        const cloneNode = el.cloneNode(true);
        if (cloneNode instanceof Element && unwantedSel)
          cloneNode.querySelectorAll(unwantedSel).forEach((e) => e.remove());
        return cloneNode instanceof Element ? cloneNode.innerHTML : "";
      })
      .join("\n");
    return { title, dateText: "", contentHtml };
  }, UNWANTED_ELEMENTS);
}
