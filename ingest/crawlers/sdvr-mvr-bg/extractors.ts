import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import {
  extractPostLinks as extractPostLinksShared,
  extractPostDetailsGeneric,
} from "../shared/extractors";

/**
 * Extract article links from the news listing page.
 * Accepts only URLs ending with a numeric article ID
 * (e.g. /новини/90207), excluding category, tag, and pagination links.
 */
export async function extractPostLinks(page: Page): Promise<PostLink[]> {
  const urlFilter = (url: string) => {
    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(url).toLowerCase();
    } catch {
      decodedUrl = url.toLowerCase();
    }
    return decodedUrl.includes("новини/") && /\/\d+\/?$/.test(decodedUrl);
  };

  return extractPostLinksShared(page, SELECTORS, urlFilter);
}

/**
 * Extract article details from an individual news article page.
 */
export async function extractPostDetails(
  page: Page,
): Promise<{ title: string; dateText: string; contentHtml: string }> {
  return extractPostDetailsGeneric(page, SELECTORS.POST, [
    "script",
    "style",
    "nav",
    "img",
  ]);
}
