import type { Page } from "playwright";
import type { PostLink } from "./types";
import { SELECTORS } from "./selectors";
import {
  extractPostLinks as extractPostLinksShared,
  extractPostDetailsGeneric,
} from "../shared/extractors";
import { parseBulgarianDate } from "../shared/date-utils";

const DETAIL_URL_PATTERN =
  /\/wps\/portal\/municipality-serdika\/actual\/(messages|news|events)\/[^/?#]+$/;

export async function extractPostLinks(page: Page): Promise<PostLink[]> {
  await page.waitForSelector(SELECTORS.INDEX.POST_CONTAINER, { timeout: 45000 });
  return extractPostLinksShared(page, SELECTORS, (url) =>
    DETAIL_URL_PATTERN.test(url),
  );
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
