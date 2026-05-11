import type { Page } from "playwright";
import type { PostLink } from "./types";
import {
  fetchFeedXml,
  parseRssFeedItems,
  RSS_FEED_FETCH_TIMEOUT_MS,
} from "../shared/rss";

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
 * Merge page-extracted post details with RSS feed data.
 * The RSS date is always used (the detail page has no machine-readable date).
 * The RSS title is used as a fallback when the page extractor returns an empty
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
 * Fetch the RSS feed XML for the sofia.bg repairs page.
 */
export { fetchFeedXml, RSS_FEED_FETCH_TIMEOUT_MS as FEED_FETCH_TIMEOUT_MS };

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
 * Date is not extracted from the page — it comes from the RSS feed.
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
