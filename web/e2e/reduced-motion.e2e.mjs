import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { expect } from "playwright/test";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3000";

test("map filters respond to changes in the system motion preference", async () => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      localStorage.setItem("categoryFilter", JSON.stringify({
        selectedCategories: [],
        hasInteracted: true,
        showArchived: false,
      }));
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const openFilters = page.getByRole("button", { name: "Отвори филтрите" });
    const filterPanel = openFilters.locator("..");
    await expect(filterPanel).toHaveCSS("transition-property", /transform/);
    await openFilters.click();

    const categories = page.getByRole("button", { name: "Категории", exact: true });
    const chevron = categories.locator("svg");
    await expect(chevron).toHaveCSS("transition-property", /transform/);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(chevron).toHaveCSS("transition-property", "none");
    await categories.click();
    await expect(categories).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Escape");
    await expect(openFilters).toBeVisible();
    await expect(filterPanel).toHaveCSS("transition-property", "none");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(filterPanel).toHaveCSS("transition-property", /transform/);
  } finally {
    await browser.close();
  }
});
