import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import { extractPostLinks as extractPostLinksShared } from "../shared/extractors";
import { isRecord } from "../../lib/record-fields";

function extractDateFromStructuredDataNode(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = extractDateFromStructuredDataNode(entry);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  if (!isRecord(node)) {
    return undefined;
  }

  const datePublished = node.datePublished;
  if (typeof datePublished === "string" && datePublished.trim()) {
    return datePublished.trim();
  }

  const dateModified = node.dateModified;
  if (typeof dateModified === "string" && dateModified.trim()) {
    return dateModified.trim();
  }

  const graph = node["@graph"];
  if (Array.isArray(graph)) {
    for (const graphNode of graph) {
      const found = extractDateFromStructuredDataNode(graphNode);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

export function extractDateFromJsonLdScripts(
  scripts: string[],
): string | undefined {
  for (const scriptContent of scripts) {
    if (!scriptContent.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(scriptContent);
      const found = extractDateFromStructuredDataNode(parsed);
      if (found) {
        return found;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function extractPostLinks(page: Page): Promise<PostLink[]> {
  const urlFilter = (url: string) => {
    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(url).toLowerCase();
    } catch {
      decodedUrl = url.toLowerCase();
    }

    return (
      decodedUrl.startsWith("https://triaditza.org/") &&
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
  const details = await page.evaluate((selectors) => {
    const titleEl = document.querySelector(selectors.POST.TITLE);
    const title = titleEl?.textContent?.trim() || "";

    const structuredDataScripts = Array.from(
      document.querySelectorAll("script[type='application/ld+json']"),
    )
      .map((script) => script.textContent || "")
      .filter(Boolean);

    const dateCandidates: string[] = [];

    const dateMetaCandidates = [
      "meta[property='article:published_time']",
      "meta[property='article:modified_time']",
      "meta[name='article:published_time']",
      "meta[name='article:modified_time']",
      "meta[itemprop='datePublished']",
      "meta[itemprop='dateModified']",
    ];

    for (const selector of dateMetaCandidates) {
      const metaEl = document.querySelector(selector);
      const content = metaEl?.getAttribute("content")?.trim();
      if (content) {
        dateCandidates.push(content);
      }
    }

    const dateTimeEl = document.querySelector("time[datetime]");
    const dateTime = dateTimeEl?.getAttribute("datetime")?.trim();
    if (dateTime) {
      dateCandidates.push(dateTime);
    }

    const visibleDateEls = Array.from(
      document.querySelectorAll(selectors.POST.DATE),
    );
    for (const dateEl of visibleDateEls) {
      const text = dateEl.textContent?.replace(/\s+/g, " ").trim() || "";
      if (text.length <= 80 && /\d/.test(text)) {
        dateCandidates.push(text);
      }
    }

    const contentEl = document.querySelector(selectors.POST.CONTENT);
    let contentHtml = "";

    if (contentEl) {
      const clone = contentEl.cloneNode(true);
      if (!(clone instanceof HTMLElement)) {
        return {
          title,
          contentHtml: "",
          dateCandidates,
          structuredDataScripts,
        };
      }
      clone
        .querySelectorAll(
          "script, style, nav, .sharedaddy, .share-buttons, .navigation, .post-navigation, .wp-block-buttons, .wp-block-social-links, footer",
        )
        .forEach((el) => el.remove());
      contentHtml = clone.innerHTML;
    }

    return {
      title,
      contentHtml,
      dateCandidates,
      structuredDataScripts,
    };
  }, SELECTORS);

  const structuredDate = extractDateFromJsonLdScripts(
    details.structuredDataScripts,
  );
  const fallbackDate =
    details.dateCandidates.find((value) => value.trim().length > 0) ?? "";

  return {
    title: details.title,
    contentHtml: details.contentHtml,
    dateText: structuredDate ?? fallbackDate,
  };
}
