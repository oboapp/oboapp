import type { Page } from "playwright";
import { logger } from "@/lib/logger";

export interface PostLink {
  url: string;
  title: string;
  date: string;
}

interface Selectors {
  INDEX: {
    POST_CONTAINER: string;
    POST_LINK: string;
    POST_TITLE: string;
    POST_DATE: string;
  };
  POST: {
    CONTENT?: string;
    TITLE: string;
    DATE: string;
  };
}

/**
 * Extract post links from an index page using CSS selectors
 * @param page - Playwright page object
 * @param selectors - CSS selectors for extracting post data
 * @param urlFilter - Optional function to filter URLs (return false to skip)
 */
export async function extractPostLinks(
  page: Page,
  selectors: Selectors,
  urlFilter?: (url: string) => boolean
): Promise<PostLink[]> {
  logger.debug("Extracting post links from index page");

  const posts = await page.evaluate((selectors) => {
    const postLinks: { url: string; title: string; date: string }[] = [];

    // Find all article containers
    const containers = document.querySelectorAll(
      selectors.INDEX.POST_CONTAINER
    );

    containers.forEach((container) => {
      // Find the link to the article
      const linkEl = container.querySelector(selectors.INDEX.POST_LINK);
      if (!linkEl) return;

      const url =
        linkEl instanceof HTMLAnchorElement ? linkEl.href : "";

      // Extract title
      const titleEl = container.querySelector(selectors.INDEX.POST_TITLE);
      const title = titleEl?.textContent?.trim() || "";

      // Extract date
      const dateEl = container.querySelector(selectors.INDEX.POST_DATE);
      const date = dateEl?.textContent?.trim() || "";

      if (url && title) {
        postLinks.push({ url, title, date });
      }
    });

    return postLinks;
  }, selectors);

  // Apply URL filter if provided
  const filteredPosts = urlFilter
    ? posts.filter((p) => urlFilter(p.url))
    : posts;

  logger.debug("Found posts on index page", { count: filteredPosts.length });
  return filteredPosts;
}

/**
 * Extract post details from individual post page using CSS selectors
 * @param page - Playwright page object
 * @param selectors - CSS selectors for extracting post data
 * @param unwantedElements - Array of CSS selectors for elements to remove from content (defaults to ["script", "style"])
 */
export async function extractPostDetailsGeneric(
  page: Page,
  selectors: {
    TITLE: string;
    DATE: string;
    CONTENT: string;
  },
  unwantedElements: string[] = ["script", "style"]
): Promise<{ title: string; dateText: string; contentHtml: string }> {
  const details = await page.evaluate(
    ({ selectors, unwantedElements }) => {
      // Extract title
      const titleEl = document.querySelector(selectors.TITLE);
      const title = titleEl?.textContent?.trim() || "";

      // Extract date
      const dateEl = document.querySelector(selectors.DATE);
      const dateText = dateEl?.textContent?.trim() || "";

      // Extract main content
      const contentEl = document.querySelector(selectors.CONTENT);

      let contentHtml = "";
      if (contentEl) {
        // Clone the element to avoid modifying the page
        const clone = contentEl.cloneNode(true);
        if (!(clone instanceof HTMLElement)) return { title: "", dateText: "", contentHtml: "" };

        // Remove unwanted elements
        const selector = unwantedElements.join(", ");
        if (selector) {
          clone.querySelectorAll(selector).forEach((el) => el.remove());
        }

        contentHtml = clone.innerHTML;
      }

      return {
        title,
        dateText,
        contentHtml,
      };
    },
    { selectors, unwantedElements }
  );

  return details;
}
