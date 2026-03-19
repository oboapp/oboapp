import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import {
  extractPostLinks as extractPostLinksShared,
  extractPostDetailsGeneric,
} from "../shared/extractors";

export async function extractPostLinks(page: Page): Promise<PostLink[]> {
  const urlFilter = (url: string) => {
    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(url).toLowerCase();
    } catch {
      decodedUrl = url.toLowerCase();
    }

    return (
      decodedUrl.startsWith("https://ilinden.sofia.bg/") &&
      !decodedUrl.includes("/category/") &&
      !decodedUrl.includes("/tag/") &&
      !decodedUrl.includes("/page/") &&
      !decodedUrl.includes("#")
    );
  };

  return extractPostLinksShared(page, SELECTORS, urlFilter);
}

export async function extractPostDetails(
  page: Page,
): Promise<{ title: string; dateText: string; contentHtml: string }> {
  return extractPostDetailsGeneric(page, SELECTORS.POST, [
    "script",
    "style",
    "nav",
    ".sharedaddy",
    ".share-buttons",
    ".navigation",
    ".post-navigation",
    ".wp-block-buttons",
    ".wp-block-social-links",
    ".related-posts",
    "footer",
  ]);
}
