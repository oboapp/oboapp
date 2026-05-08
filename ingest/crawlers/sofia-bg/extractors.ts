import type { Page } from "playwright";
import type { PostLink } from "./types";
import { decode as decodeHtmlEntities } from "html-entities";

export const FEED_FETCH_TIMEOUT_MS = 30_000;

function stripCdata(text: string): string {
  return text.replace(/^<!\[CDATA\[([\s\S]*?)]]>$/, "$1");
}

/**
 * Fetch the RSS feed XML for the sofia.bg repairs page.
 * Throws if the response is not an RSS feed (e.g. HTML anti-bot page).
 */
export async function fetchFeedXml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; oboapp-crawler/1.0)" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RSS feed returned ${response.status} for ${url}`);
    }
    const text = await response.text();
    if (!text.includes("<rss") && !text.includes("<channel>")) {
      throw new Error(
        `RSS feed response does not look like RSS (possible anti-bot or error page) for ${url}`,
      );
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse RSS feed XML into a list of post links.
 * Each <item> must have <title>, <link>, and <dc:date> (ISO 8601).
 * Items missing any required field are skipped.
 */
export function parseFeedItems(xml: string): PostLink[] {
  const postLinks: PostLink[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const itemXml = m[1];

    const title = decodeHtmlEntities(
      stripCdata(
        itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "",
      ),
    );
    const url = decodeHtmlEntities(
      stripCdata(itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? ""),
    );
    const date = stripCdata(
      itemXml.match(/<dc:date>([\s\S]*?)<\/dc:date>/)?.[1]?.trim() ?? "",
    );

    if (!title || !url || !date) continue;

    // Validate URL stays on the expected host to avoid navigating to arbitrary sites.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      continue;
    }
    if (parsedUrl.hostname !== "www.sofia.bg") continue;

    // Strip query parameters — RSS feed links (e.g. from the news feed) include a
    // Liferay ?redirect=... param that causes redirect loops when navigated to
    // unauthenticated. The article path (/w/{id}) is self-contained.
    parsedUrl.search = "";
    const cleanUrl = parsedUrl.toString();

    // Validate date is parseable and normalize to canonical UTC ISO 8601.
    const dateMs = Date.parse(date);
    if (isNaN(dateMs)) continue;

    postLinks.push({ url: cleanUrl, title, date: new Date(dateMs).toISOString() });
  }

  return postLinks;
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
