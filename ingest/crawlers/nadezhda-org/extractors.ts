import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import {
  extractPostLinks as extractPostLinksShared,
  extractPostDetailsGeneric,
} from "../shared/extractors";

export async function extractPostLinks(page: Page): Promise<PostLink[]> {
  const posts = await extractPostLinksShared(page, SELECTORS, (url) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "nadezhda.sofia.bg" && parsed.pathname.includes("/news/");
    } catch {
      return false;
    }
  });

  return Array.from(new Map(posts.map((post) => [post.url, post])).values());
}

export async function extractPostDetails(
  page: Page,
): Promise<{ title: string; dateText: string; contentHtml: string }> {
  return extractPostDetailsGeneric(page, SELECTORS.POST, [
    "script",
    "style",
    "nav",
    "footer",
    ".breadcrumb",
  ]);
}
