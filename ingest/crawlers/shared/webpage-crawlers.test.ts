import type { Browser, Page, Route } from "playwright";
import type { OboDb } from "@oboapp/db";
import { describe, expect, it, vi } from "vitest";
import {
  buildWebPageSourceDocument,
  crawlWordpressPage,
  processWordpressPost,
} from "./webpage-crawlers";
import { isUrlProcessed, saveSourceDocument } from "./firestore";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(async () => ({ collection: vi.fn() })),
}));

vi.mock("@/lib/delay", () => ({
  delay: vi.fn(async () => undefined),
}));

vi.mock("./firestore", () => ({
  isUrlProcessed: vi.fn(async () => false),
  saveSourceDocument: vi.fn(async () => undefined),
}));

function createRoute(resourceType: string) {
  return {
    route: {
      request: vi.fn(() => ({ resourceType: vi.fn(() => resourceType) })),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    } as unknown as Route,
  };
}

function createMockPage() {
  let routeHandler: Parameters<Page["route"]>[1] | null = null;

  const page = {
    route: vi.fn(async (_pattern, handler) => {
      routeHandler = handler;
    }),
    goto: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  } as unknown as Page;

  return {
    page,
    getRouteHandler: () => {
      if (!routeHandler) {
        throw new Error("Expected route handler to be configured");
      }

      return routeHandler;
    },
  };
}

function createMockBrowser(page: Page): Browser {
  return {
    newPage: vi.fn(async () => page),
  } as unknown as Browser;
}

describe("shared/webpage-crawlers", () => {
  describe("buildWebPageSourceDocument", () => {
    it("should build source document with HTML to Markdown conversion", () => {
      const doc = buildWebPageSourceDocument({
        url: "https://example.com/post",
        title: "Test Title",
        dateText: "15 декември 2025",
        contentHtml: "<h2>Heading</h2><p>Paragraph</p>",
        sourceType: "test-source",
        locality: "bg.sofia",
      });

      expect(doc.url).toBe("https://example.com/post");
      expect(doc.title).toBe("Test Title");
      expect(doc.sourceType).toBe("test-source");
      expect(doc.message).toContain("Heading");
      expect(doc.message).toContain("Paragraph");
      expect(doc.datePublished).toBeTruthy();
    });

    it("should throw error for empty title", () => {
      expect(() =>
        buildWebPageSourceDocument({
          url: "https://example.com/post",
          title: "",
          dateText: "1 януари 2025",
          contentHtml: "<p>Content</p>",
          sourceType: "test-source",
          locality: "bg.sofia",
        })
      ).toThrow("Failed to extract title");
    });

    it("should throw error for empty content", () => {
      expect(() =>
        buildWebPageSourceDocument({
          url: "https://example.com/post",
          title: "Title",
          dateText: "1 януари 2025",
          contentHtml: "",
          sourceType: "test-source",
          locality: "bg.sofia",
        })
      ).toThrow("Failed to extract content");
    });

    it("should handle complex HTML", () => {
      const html = `
        <div>
          <h1>Main Title</h1>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
          <p>Text with <strong>bold</strong> and <em>italic</em></p>
        </div>
      `;

      const doc = buildWebPageSourceDocument({
        url: "https://example.com/post",
        title: "Test",
        dateText: "1 януари 2025",
        contentHtml: html,
        sourceType: "test-source",
        locality: "bg.sofia",
      });

      expect(doc.message).toContain("Main Title");
      expect(doc.message).toContain("Item 1");
      expect(doc.message).toContain("**bold**");
      expect(doc.message).toContain("_italic_"); // Turndown uses underscores for emphasis
    });
  });

  describe("resource blocking", () => {
    it("uses lightweight defaults on the index page", async () => {
      const { page, getRouteHandler } = createMockPage();
      const browser = createMockBrowser(page);

      await crawlWordpressPage({
        indexUrl: "https://example.com/news",
        sourceType: "test-source",
        extractPostLinks: async () => [],
        processPost: vi.fn(),
        browser,
      });

      expect(page.route).toHaveBeenCalledWith("**/*", expect.any(Function));
      expect(page.goto).toHaveBeenCalledWith("https://example.com/news", {
        waitUntil: "domcontentloaded",
      });

      const routeHandler = getRouteHandler();
      const imageRoute = createRoute("image");
      const fontRoute = createRoute("font");
      const scriptRoute = createRoute("script");

      await routeHandler(imageRoute.route, {} as never);
      await routeHandler(fontRoute.route, {} as never);
      await routeHandler(scriptRoute.route, {} as never);

      expect(imageRoute.route.abort).toHaveBeenCalledTimes(1);
      expect(imageRoute.route.continue).not.toHaveBeenCalled();
      expect(fontRoute.route.abort).toHaveBeenCalledTimes(1);
      expect(fontRoute.route.continue).not.toHaveBeenCalled();
      expect(scriptRoute.route.continue).toHaveBeenCalledTimes(1);
      expect(scriptRoute.route.abort).not.toHaveBeenCalled();
    });

    it("uses lightweight defaults on post pages", async () => {
      const { page, getRouteHandler } = createMockPage();
      const browser = createMockBrowser(page);
      const db = {} as OboDb;
      const postLink = {
        url: "https://example.com/news/heavy-post",
        title: "Heavy post",
        date: "",
      };

      await processWordpressPost(
        browser,
        postLink,
        db,
        "test-source",
        "bg.sofia",
        0,
        async () => ({
          title: "Heavy post",
          dateText: "2026-05-29T10:00:00+03:00",
          contentHtml: "<p>Content</p>",
        }),
      );

      expect(page.route).toHaveBeenCalledWith("**/*", expect.any(Function));
      expect(page.goto).toHaveBeenCalledWith(
        "https://example.com/news/heavy-post",
        { waitUntil: "domcontentloaded" },
      );
      expect(saveSourceDocument).toHaveBeenCalledTimes(1);
      expect(isUrlProcessed).not.toHaveBeenCalled();

      const routeHandler = getRouteHandler();
      const mediaRoute = createRoute("media");
      const imageRoute = createRoute("image");
      const stylesheetRoute = createRoute("stylesheet");

      await routeHandler(mediaRoute.route, {} as never);
      await routeHandler(imageRoute.route, {} as never);
      await routeHandler(stylesheetRoute.route, {} as never);

      expect(mediaRoute.route.abort).toHaveBeenCalledTimes(1);
      expect(mediaRoute.route.continue).not.toHaveBeenCalled();
      expect(imageRoute.route.abort).toHaveBeenCalledTimes(1);
      expect(imageRoute.route.continue).not.toHaveBeenCalled();
      expect(stylesheetRoute.route.continue).toHaveBeenCalledTimes(1);
      expect(stylesheetRoute.route.abort).not.toHaveBeenCalled();
    });
  });
});
