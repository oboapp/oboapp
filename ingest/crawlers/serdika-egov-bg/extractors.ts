import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import {
  extractPostDetailsGeneric,
} from "../shared/extractors";
import { parseBulgarianDate } from "../shared/date-utils";

// IBM WebSphere Portal search feed — populated server-side, no JavaScript needed.
const SEARCH_FEED_BASE = "https://serdika.egov.bg/wps/contenthandler/searchfeed/search";
const SEARCH_SCOPE_ID = "1672924193550";
const WCM_CONTENT_PREFIX = "/content/site/";
const PORTAL_BASE = "https://serdika.egov.bg/wps/portal/municipality-serdika/";
const FEED_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch the list of posts for one site section from the portal's ATOM search
 * feed — avoiding Playwright entirely for the listing page (the AJAX-rendered
 * `#search-results-container` is unreachable from Cloud Run IPs).
 *
 * @param sectionKeyword  e.g. "actualmessages", "actualnews", "actualevents"
 */
export async function fetchPostLinksFromFeed(
  sectionKeyword: string,
): Promise<PostLink[]> {
  const params = new URLSearchParams({
    queryLang: "en",
    locale: "bg",
    resultLang: "bg",
    start: "0",
    results: "20",
    scope: SEARCH_SCOPE_ID,
    query: "*",
    sortKey: "effectivedate",
    sortOrder: "desc",
  });
  // Two separate constraint params (URLSearchParams.append keeps both)
  params.append(
    "constraint",
    JSON.stringify({ type: "field", id: "authoringtemplate", values: ["contentFromList"] }),
  );
  params.append(
    "constraint",
    JSON.stringify({ type: "field", id: "keywords", values: [sectionKeyword] }),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

  let xml: string;
  try {
    const response = await fetch(`${SEARCH_FEED_BASE}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Search feed returned ${response.status} for keyword "${sectionKeyword}"`);
    }
    xml = await response.text();
  } finally {
    clearTimeout(timeoutId);
  }

  if (!xml.includes("<atom:feed")) {
    throw new Error(`Unexpected response format (not an ATOM feed) for keyword "${sectionKeyword}"`);
  }

  // Parse ATOM entries with simple regex — the WCM feed has a fixed, machine-
  // generated structure so regex is sufficient here.
  const postLinks: PostLink[] = [];
  const entryRe = /<atom:entry>([\s\S]*?)<\/atom:entry>/g;
  let m: RegExpExecArray | null;

  while ((m = entryRe.exec(xml)) !== null) {
    const entryXml = m[1];

    const title = decodeXmlEntities(
      entryXml.match(/<atom:title[^>]*>([\s\S]*?)<\/atom:title>/)?.[1]?.trim() ?? "",
    );

    // contentpath field: "/content/site/actual/messages/<slug>"
    const contentPath =
      entryXml.match(/<wplc:field id="contentpath">([\s\S]*?)<\/wplc:field>/)?.[1]?.trim() ?? "";
    if (!contentPath.startsWith(WCM_CONTENT_PREFIX)) continue;

    const url = PORTAL_BASE + contentPath.slice(WCM_CONTENT_PREFIX.length);

    // effectivedate is a Unix timestamp in milliseconds
    const effectiveDateMs = Number(
      entryXml.match(/<wplc:field id="effectivedate">(\d+)<\/wplc:field>/)?.[1] ?? "0",
    );
    const date = effectiveDateMs ? formatDateDDMMYYYY(new Date(effectiveDateMs)) : "";

    postLinks.push({ url, title, date });
  }

  return postLinks;
}

function formatDateDDMMYYYY(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#034;/g, '"')
    .replace(/&#039;/g, "'");
}

export async function extractPostDetails(
  page: Page,
): Promise<{ title: string; dateText: string; contentHtml: string }> {
  await page.waitForSelector(SELECTORS.POST.CONTENT, { timeout: 30000 });
  return extractPostDetailsGeneric(page, SELECTORS.POST, [
    "script",
    "style",
    "nav",
    "header",
  ]);
}

/**
 * Parse the `#publish-date` block on Serdika detail pages.
 *
 * The div bundles multiple labeled dates (e.g. for events: `Дата на събитие`,
 * `Дата на публикуване`, `Последна актуализация`). We prefer the publish date
 * if present, otherwise the first `DD.MM.YYYY` occurrence.
 */
export function parseSerdikaDate(dateText: string): string {
  const publishMatch = dateText.match(
    /Дата на публикуване\s*:?\s*(\d{2}\.\d{2}\.\d{4})/,
  );
  if (publishMatch) {
    return parseBulgarianDate(publishMatch[1]);
  }

  const firstDate = dateText.match(/\d{2}\.\d{2}\.\d{4}/);
  if (firstDate) {
    return parseBulgarianDate(firstDate[0]);
  }

  return parseBulgarianDate(dateText.trim());
}
