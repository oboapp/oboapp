/**
 * CSS selectors for scraping sofia.bg repairs page
 */
export const SELECTORS = {
  // Individual post page selectors
  POST: {
    // Main content container for the specific article
    CONTENT: ".asset-content",
    // Title element
    TITLE: ".asset-title",
    // Date comes from the RSS feed, not the page; this selector intentionally matches nothing.
    DATE: "[data-obo-never-match]",
  },
} as const;
