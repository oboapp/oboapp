import type { Browser } from "playwright";
import type { PostLink } from "./types";
import { extractListingPage, REPAIRS_LISTING_URL, fetchFeedXml, parseFeedItems } from "./extractors";
import { delay } from "@/lib/delay";
import { logger } from "@/lib/logger";

const NEWS_FEED_URL = "https://www.sofia.bg/news/-/asset_publisher/1ZlMReQfODHE/rss";
export const NEWS_LISTING_URL = "https://www.sofia.bg/bg/news";
// Bound a cold start to the latest 120 articles instead of crawling the archive.
const MAX_LISTING_PAGES = 10;

export async function discoverListingPosts(
  browser: Browser,
  isKnown: (post: PostLink) => boolean,
  listingUrl = REPAIRS_LISTING_URL,
): Promise<PostLink[]> {
  const page = await browser.newPage();
  const posts: PostLink[] = [];
  const visited = new Set<string>();
  let url: string | null = listingUrl;
  try {
    await page.route("**/*", async (route) => {
      if (["image", "media", "font"].includes(route.request().resourceType())) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    while (url && visited.size < MAX_LISTING_PAGES) {
      if (visited.has(url)) throw new Error(`Listing pagination repeated a page: ${url}`);
      visited.add(url);
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!response?.ok()) {
        throw new Error(`Listing HTTP ${response?.status() ?? "no response"}: ${url}`);
      }
      const listing = await extractListingPage(page, listingUrl);
      if (listing.posts.length === 0) throw new Error(`No dated articles found on listing: ${url}`);
      posts.push(...listing.posts);
      if (listing.posts.every(isKnown)) return posts;
      url = listing.nextUrl;
      if (url) await delay(2000);
    }
    if (url) {
      logger.warn("Sofia listing reached page safety limit", {
        sourceType: "sofia-bg", listingUrl, pages: MAX_LISTING_PAGES, count: posts.length,
      });
    }
    return posts;
  } finally {
    await page.close();
  }
}

/** Attempt both sources even if either discovery fails. */
export async function discoverPosts(
  repairs: () => Promise<PostLink[]>,
  newsFallback: () => Promise<PostLink[]>,
): Promise<{ posts: PostLink[]; errors: unknown[] }> {
  const posts: PostLink[] = [];
  const errors: unknown[] = [];
  for (const [source, discover] of [
    ["repairs listing", repairs],
    ["news", async () => {
      try {
        return parseFeedItems(await fetchFeedXml(NEWS_FEED_URL));
      } catch (error) {
        logger.warn("News RSS unavailable, using public listing", {
          sourceType: "sofia-bg",
          error: error instanceof Error ? error.message : String(error),
        });
        return newsFallback();
      }
    }],
  ] satisfies [string, () => Promise<PostLink[]>][]) {
    try {
      posts.push(...await discover());
    } catch (error) {
      errors.push(error);
      logger.error("Failed to discover Sofia articles", {
        sourceType: "sofia-bg",
        source,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { posts, errors };
}
