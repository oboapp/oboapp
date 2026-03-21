import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import {
  extractPostDetailsGeneric,
} from "../shared/extractors";
import { logger } from "@/lib/logger";

export async function extractPostLinks(page: Page): Promise<PostLink[]> {
  logger.debug("Extracting post links from index page");

  const posts = await page.evaluate((selectors) => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(selectors.INDEX.POST_LINK),
    );

    const result: { url: string; title: string; date: string }[] = [];

    for (const linkEl of links) {
      const url = linkEl.href?.trim() || "";
      const title = linkEl.textContent?.replace(/\s+/g, " ").trim() || "";

      if (!url || !title) {
        continue;
      }

      const container = linkEl.closest(selectors.INDEX.POST_CONTAINER);
      const dateText =
        container
          ?.querySelector(selectors.INDEX.POST_DATE)
          ?.textContent?.replace(/\s+/g, " ")
          .trim() || "";

      result.push({
        url,
        title,
        date: dateText,
      });
    }

    return result;
  }, SELECTORS);

  const dedupedPosts = Array.from(
    new Map(posts.map((post) => [post.url, post])).values(),
  );

  const filteredPosts = dedupedPosts.filter((post) => {
    if (!post.url || !post.title || post.title === "Печат") {
      return false;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(post.url);
    } catch {
      return false;
    }

    const path = parsedUrl.pathname.toLowerCase();
    if (!path.startsWith("/home/latest-news/")) {
      return false;
    }

    const slug = path.replace("/home/latest-news/", "").replace(/\/$/, "");
    if (!slug || slug.includes("/")) {
      return false;
    }

    if (parsedUrl.search.includes("tmpl=component")) {
      return false;
    }

    return true;
  });

  logger.debug("Found posts on index page", { count: filteredPosts.length });

  return filteredPosts;
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
