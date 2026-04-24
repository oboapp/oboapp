/**
 * CSS selectors for scraping www.mvr.bg/sdvr news.
 *
 * Listing page (.card grid):
 *   .card
 *     .card__meta          — date text, e.g. "23 Април 2026"
 *     a.card__title        — link to article + title text
 *
 * Detail page:
 *   .page-content__header
 *     small                — date text, e.g. "21 Април 2026"
 *     h1.page-title        — article title
 *   .page-content          — article body HTML
 */
export const SELECTORS = {
  INDEX: {
    POST_CONTAINER: ".card",
    POST_LINK: "a.card__title",
    POST_TITLE: "a.card__title",
    POST_DATE: ".card__meta",
  },
  POST: {
    TITLE: "h1.page-title",
    DATE: ".page-content__header small",
    CONTENT: ".page-content",
  },
} as const;
