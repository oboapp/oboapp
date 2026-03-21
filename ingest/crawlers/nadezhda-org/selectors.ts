/**
 * CSS selectors for scraping nadezhda.sofia.bg announcements.
 */
export const SELECTORS = {
  INDEX: {
    POST_CONTAINER: "li.shadow-sm",
    POST_LINK: 'a[href*="/news/"]',
    POST_DATE: "small, .small, .date, [class*=date]",
    POST_TITLE: "a",
  },

  POST: {
    CONTENT:
      ".justify-content-center > div > .bg-white.mt-2 > .p-2, .justify-content-center > div .p-2",
    TITLE: ".justify-content-center > div > h1.pl-2, .justify-content-center h1.pl-2",
    DATE:
      ".justify-content-center > div > .bg-white.mt-2 > small.pl-2, .justify-content-center small.pl-2",
  },
} as const;
