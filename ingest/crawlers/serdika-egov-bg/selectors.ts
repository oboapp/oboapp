/**
 * CSS selectors for serdika.egov.bg (IBM WebSphere Portal).
 *
 * Avoids portal-generated ids (`Z6_*`, `Z7_*`, `.wptheme*`) because those rotate
 * on portal redeploy. Anchors on: URL-pattern links, semantic element ids
 * chosen by the site developer (`#search-results-container`, `#publish-date`,
 * `#body`), and semantic elements (`h2` inside `.content-wrapper`).
 */
export const SELECTORS = {
  INDEX: {
    POST_CONTAINER: "#search-results-container .card10.bb",
    POST_LINK: 'a[href*="/actual/"]',
    POST_TITLE: 'a[href*="/actual/"]',
    POST_DATE: "span.flex-col",
  },
  POST: {
    TITLE: ".content-wrapper h2",
    DATE: "#publish-date",
    CONTENT: "#body",
  },
} as const;
