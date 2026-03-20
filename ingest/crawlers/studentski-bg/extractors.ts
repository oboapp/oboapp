import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import { extractPostLinks as extractPostLinksShared } from "../shared/extractors";

/**
 * Extract post links from the index page (first page only)
 */
export async function extractPostLinks(page: Page): Promise<PostLink[]> {
  return extractPostLinksShared(page, SELECTORS);
}

/**
 * Extract post details from individual post page
 * @param page Playwright Page object on the post detail page
 * @returns Object with title, dateText, and contentHtml
 */
export async function extractPostDetails(page: Page): Promise<{
  title: string;
  dateText: string;
  contentHtml: string;
}> {
  const details = await page.evaluate((selectors) => {
    // Extract title
    const titleEl = document.querySelector(selectors.POST.TITLE);
    const title = titleEl?.textContent?.trim() || "";

    // Extract date from text content (Bulgarian DD.MM.YYYY format)
    const dateEl = document.querySelector(selectors.POST.DATE);
    const dateText = dateEl?.textContent?.trim() || "";

    // Extract content HTML
    const contentEl = document.querySelector(selectors.POST.CONTENT);
    let contentHtml = "";

    if (contentEl) {
      const clone = contentEl.cloneNode(true);
      if (!(clone instanceof HTMLElement)) return { title: "", dateText: "", contentHtml: "" };

      // Remove unwanted elements
      clone
        .querySelectorAll("script, style, nav, .comments, .sharedaddy")
        .forEach((el) => el.remove());

      contentHtml = clone.innerHTML;
    }

    return { title, dateText, contentHtml };
  }, SELECTORS);

  return details;
}
