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
 */
export async function extractPostDetails(
  page: Page
): Promise<{ title: string; dateText: string; contentHtml: string }> {
  const details = await page.evaluate((selectors) => {
    // Extract title from first component-paragraph div
    // This contains the title text on sofia.bg article pages
    const componentParagraphs = document.querySelectorAll(
      ".component-paragraph"
    );
    let title = "";

    if (componentParagraphs.length > 0) {
      // First component-paragraph usually contains the title
      const firstParagraph = componentParagraphs[0];
      if (firstParagraph instanceof HTMLElement) {
        title = firstParagraph.textContent?.trim() || "";

        // If title is very long, it might include content, try to get just first line/paragraph
        const firstChild = firstParagraph.querySelector("p, div");
        if (
          firstChild?.textContent &&
          firstChild.textContent.length < title.length
        ) {
          title = firstChild.textContent.trim();
        }
      }
    }

    // Fallback to h1 or other headings if component-paragraph approach fails
    if (!title) {
      const headingEl = document.querySelector("h1, h2, h3");
      title = headingEl?.textContent?.trim() || "";
    }

    // Extract date - look for date in footer or date elements
    const dateEl = document.querySelector(selectors.POST.DATE);
    const dateText = dateEl?.textContent?.trim() || "";

    // Extract main content - get all component-paragraph divs
    let contentHtml = "";
    if (componentParagraphs.length > 0) {
      // Create a container for all paragraphs
      const container = document.createElement("div");
      componentParagraphs.forEach((p) => {
        const clone = p.cloneNode(true);
        if (clone instanceof HTMLElement) {
          // Remove unwanted elements
          clone
            .querySelectorAll(
              "script, style, nav, .navigation, .share-buttons, .social-share"
            )
            .forEach((el) => el.remove());
          container.appendChild(clone);
        }
      });
      contentHtml = container.innerHTML;
    } else {
      // Fallback: get main-content
      const mainContent = document.querySelector("#main-content");
      if (mainContent) {
        const clone = mainContent.cloneNode(true);
        if (clone instanceof HTMLElement) {
          clone
            .querySelectorAll(
              "script, style, nav, .navigation, .share-buttons, .social-share, header, footer"
            )
            .forEach((el) => el.remove());
          contentHtml = clone.innerHTML;
        }
      }
    }

    return {
      title,
      dateText,
      contentHtml,
    };
  }, SELECTORS);

  return details;
}
