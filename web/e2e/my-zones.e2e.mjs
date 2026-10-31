import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect } from "playwright/test";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3000";
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname),
  "Run this smoke test against a local MSW development server.",
);
const browserChannel = process.env.PLAYWRIGHT_CHANNEL;
const artifactDirectory = fileURLToPath(
  new URL("../../tmp/my-zones-e2e/", import.meta.url),
);

function isApiResponse(response, pathname, method = "GET") {
  return (
    new URL(response.url()).pathname === pathname &&
    response.request().method() === method
  );
}

async function mapFeatureCount(page) {
  return page.locator('.gm-style [role="button"]').evaluateAll((markers) => {
    let count = 0;
    for (const marker of markers) {
      const label = marker.getAttribute("aria-label") || "";
      if (label === "Маркер") {
        count += 1;
      } else if (/^\d+$/.test(label)) {
        count += Number(label);
      }
    }
    return count;
  });
}

function eventCard(page, text) {
  return page.locator("button").filter({ hasText: text });
}

async function deleteMockZone(page, label) {
  await page.getByRole("button", { name: `Действия за ${label}` }).click();
  await page.getByRole("menuitem", { name: "Изтрий", exact: true }).click();
  const deleted = page.waitForResponse((response) => {
    return isApiResponse(response, "/api/interests", "DELETE");
  });
  await page.getByRole("button", { name: "Изтрий зоната", exact: true }).click();
  const response = await deleted;
  assert.equal(response.fromServiceWorker(), true);
  assert.equal(response.ok(), true);
  await expect(
    page.getByRole("button", { name: `Действия за ${label}` }),
  ).toHaveCount(0);
}

test("My zones shows filtered cards below zones and keeps map and responsive behavior consistent", {
  timeout: 240_000,
}, async (context) => {
  const browser = await chromium.launch({ channel: browserChannel });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await mkdir(artifactDirectory, { recursive: true });
  try {
    await page.addInitScript(() => {
      localStorage.setItem("categoryFilter", JSON.stringify({
        selectedCategories: [],
        hasInteracted: true,
        showArchived: true,
      }));
    });

    const [interests, messages] = await Promise.all([
      page.waitForResponse((response) => {
        return isApiResponse(response, "/api/interests");
      }, { timeout: 90_000 }),
      page.waitForResponse((response) => {
        return isApiResponse(response, "/api/messages");
      }, { timeout: 90_000 }),
      page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 }),
    ]);
    assert.equal(interests.fromServiceWorker(), true,
      "MSW must serve the interests before this test edits mock zones.");
    const interestData = await interests.json();
    assert.deepEqual(
      interestData.interests.map((interest) => interest.id).sort(),
      ["interest-home", "interest-work"],
    );
    assert.ok(interestData.interests.every((interest) => {
      return interest.userId === "mock-user-123";
    }));
    assert.equal(messages.fromServiceWorker(), true);
    const messageData = await messages.json();
    const cityWideMessage = messageData.messages.find((message) => {
      return message.id === "msg-weather-citywide-1";
    });
    assert.ok(cityWideMessage, "The MSW response must include the citywide fixture.");
    assert.equal(cityWideMessage.cityWide, true);
    assert.equal(cityWideMessage.locality, "bg.sofia");
    assert.equal(cityWideMessage.aiProcessed, true);
    assert.equal(Object.hasOwn(cityWideMessage, "geoJson"), false,
      "This regression must use a citywide record with no geoJson field.");

    const dismissNotifications = page.getByRole("button", {
      name: "Не сега", exact: true,
    });
    if (await dismissNotifications.isVisible()) {
      await dismissNotifications.click();
    }

    const zonesMode = page.getByRole("radio", { name: "Моите зони" });
    const eventsMode = page.getByRole("radio", { name: "Събития" });
    const zoneEvents = page.getByRole("region", {
      name: "Събития в моите зони", exact: true,
    });
    const allEvents = page.getByRole("region", {
      name: "Събития", exact: true,
    });
    const roadBlockCard = eventCard(page, "Затворена улица");
    const waterCard = eventCard(page, "Планирано спиране на водоподаването");
    const cityWideCard = eventCard(page, "Жълт код за силен вятър в София");
    await expect(roadBlockCard).toBeVisible();
    await expect(cityWideCard).toBeVisible();
    await expect.poll(() => mapFeatureCount(page), {
      timeout: 30_000,
    }).toBeGreaterThan(5);
    const allFeatureCount = await mapFeatureCount(page);

    const [boundaryResponse] = await Promise.all([
      page.waitForResponse((response) => {
        return isApiResponse(response, "/api/localities/bg.sofia/boundary");
      }, { timeout: 60_000 }),
      zonesMode.click(),
    ]);
    assert.equal(boundaryResponse.ok(), true);
    const localityBoundary = await boundaryResponse.json();
    assert.equal(localityBoundary.type, "FeatureCollection");
    assert.ok(localityBoundary.features.length > 0);
    assert.ok(localityBoundary.features.every((feature) => {
      return ["Polygon", "MultiPolygon"].includes(feature.geometry.type);
    }));
    assert.ok(localityBoundary.features.some((feature) => {
      return feature.properties?.shapeISO === "BG-22";
    }), "The returned boundary must identify Sofia City.");
    await expect(zonesMode).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Действия за Вкъщи" })).toBeVisible();
    await expect(page.getByText("Зареждане...", { exact: true })).toHaveCount(0, {
      timeout: 60_000,
    });
    await expect(roadBlockCard).toHaveCount(0);
    await expect(waterCard).toBeVisible();
    await expect(zoneEvents).toBeVisible();
    await expect(zoneEvents.getByRole("heading", {
      name: "Събития в моите зони", exact: true,
    })).toBeVisible();
    await expect(eventCard(zoneEvents, "Планирано спиране на водоподаването"))
      .toBeVisible();
    await expect(eventCard(zoneEvents, "Жълт код за силен вятър в София"))
      .toBeVisible();
    const zoneListBox = await page.getByRole("list").filter({
      has: page.getByRole("button", { name: "Действия за Работа" }),
    }).boundingBox();
    const eventSectionBox = await zoneEvents.boundingBox();
    assert.ok(zoneListBox);
    assert.ok(eventSectionBox);
    assert.ok(eventSectionBox.y >= zoneListBox.y + zoneListBox.height,
      "The visible filtered event section must follow the saved zones.");
    await expect.poll(() => mapFeatureCount(page)).toBeLessThan(allFeatureCount);
    await expect.poll(() => mapFeatureCount(page)).toBeGreaterThan(0);
    const zonesFeatureCount = await mapFeatureCount(page);
    context.diagnostic(`Map features: Events=${allFeatureCount}, My zones=${zonesFeatureCount}.`);
    context.diagnostic("A citywide record with no geoJson is visible in Events and My zones after loading its bg.sofia boundary.");

    await cityWideCard.click();
    await expect(page).toHaveURL((url) => {
      return url.searchParams.get("messageId") === "msg-weather-citywide-1";
    });
    const details = page.getByRole("complementary", {
      name: "Детайли за сигнала", exact: true,
    });
    await expect(details).toBeVisible();
    await expect(details).toContainText("Жълт код за силен вятър в София");
    await details.getByRole("button", { name: "Затвори детайлите", exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(zonesMode).toHaveAttribute("aria-checked", "true");
    await expect(cityWideCard).toBeVisible();

    await page.getByRole("button", { name: "Отвори филтрите", exact: true }).click();
    const waterCategory = page.getByRole("region", { name: "Категории" })
      .getByRole("button", { name: /^Вода\s*\d*$/ });
    const categoryResponse = page.waitForResponse((response) => {
      return isApiResponse(response, "/api/messages") &&
        new URL(response.url()).searchParams.get("categories") === "water";
    });
    await waterCategory.click();
    await categoryResponse;
    await expect(waterCategory).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => mapFeatureCount(page)).toBe(1);

    await page.getByRole("button", { name: "Източници", exact: true }).click();
    const sourceResponse = page.waitForResponse((response) => {
      return isApiResponse(response, "/api/messages") &&
        new URL(response.url()).searchParams.get("sources") === "sofiyska-voda";
    });
    await page.getByRole("button", { name: "Филтрирай Софийска вода", exact: true }).click();
    await sourceResponse;
    await expect(page.getByRole("button", {
      name: "Премахни Софийска вода", exact: true,
    })).toHaveAttribute("aria-pressed", "true");
    await eventsMode.click();
    await expect(waterCategory).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => mapFeatureCount(page)).toBe(1);

    const clearedResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return isApiResponse(response, "/api/messages") &&
        !url.searchParams.has("categories") && !url.searchParams.has("sources");
    });
    await page.getByRole("button", { name: "Изчисти всички", exact: true }).click();
    await clearedResponse;
    // Clearing all filters also clears the archive option. These dated MSW
    // fixtures need it enabled again for the remaining map interactions.
    await page.getByRole("checkbox", { name: "Покажи минали", exact: true }).check();
    await expect(roadBlockCard).toBeVisible();
    await page.getByRole("button", { name: "Затвори филтрите", exact: true }).click();
    await zonesMode.click();
    await expect(roadBlockCard).toHaveCount(0);

    const mapBox = await page.locator(".gm-style").boundingBox();
    assert.ok(mapBox);
    const panResponse = page.waitForResponse((response) => {
      return isApiResponse(response, "/api/messages");
    });
    const dragX = mapBox.x + mapBox.width * 0.7;
    const dragY = mapBox.y + mapBox.height * 0.3;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 100, dragY, { steps: 12 });
    await page.mouse.up();
    assert.equal((await panResponse).fromServiceWorker(), true);
    await expect(roadBlockCard).toHaveCount(0);
    await expect(waterCard).toBeVisible();
    await expect(cityWideCard).toBeVisible();
    await page.screenshot({ path: path.join(artifactDirectory, "my-zones.png") });
    context.diagnostic("Category/source choices and the zone restriction survived a viewport refetch.");

    await page.setViewportSize({ width: 1000, height: 900 });
    await expect(zonesMode).toHaveCount(0);
    await expect(allEvents).toBeVisible();
    await expect(page.getByRole("button", { name: "Вкъщи", exact: true })).toBeVisible();
    await expect(roadBlockCard).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(zonesMode).toHaveCount(0);
    await expect(allEvents).toBeVisible();
    await expect(roadBlockCard).toBeVisible();
    const homeBadge = page.getByRole("button", { name: "Вкъщи", exact: true });
    await expect(homeBadge).toBeVisible();
    await expect(page.getByRole("button", { name: "Работа", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Добави зона", exact: true })).toBeEnabled();
    await page.screenshot({
      path: path.join(artifactDirectory, "mobile-events.png"),
      fullPage: true,
    });

    const badgeResponse = page.waitForResponse((response) => {
      if (!isApiResponse(response, "/api/messages")) {
        return false;
      }
      const params = new URL(response.url()).searchParams;
      const north = Number(params.get("north"));
      const south = Number(params.get("south"));
      const east = Number(params.get("east"));
      const west = Number(params.get("west"));
      return Math.abs((north + south) / 2 - 42.6977) < 0.001 &&
        Math.abs((east + west) / 2 - 23.3219) < 0.001 &&
        north - south < 0.02 && east - west < 0.02;
    });
    await homeBadge.click();
    assert.equal((await badgeResponse).fromServiceWorker(), true);
    await expect(allEvents).toBeVisible();
    await expect(zoneEvents).toHaveCount(0);
    await expect(waterCard).toBeVisible();
    context.diagnostic("Tablet and phone show zone badges and all Events; tapping a badge centers and zooms the map to that zone and keeps Events mode.");

    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(zonesMode).toHaveAttribute("aria-checked", "true");
    await expect(zoneEvents).toBeVisible();
    await expect(roadBlockCard).toHaveCount(0);

    await waterCard.click();
    await expect(page).toHaveURL((url) => {
      return url.searchParams.get("messageId") === "msg-water-center-1";
    });
    await expect(details).toBeVisible();
    await expect(details).toContainText("Граф Игнатиев");
    await details.getByRole("button", { name: "Затвори детайлите", exact: true }).click();
    await expect(page).toHaveURL((url) => {
      return !url.searchParams.has("messageId");
    });
    await expect(details).toHaveCount(0);
    await expect(zonesMode).toHaveAttribute("aria-checked", "true");
    await expect(waterCard).toBeVisible();
    context.diagnostic("The filtered desktop card is visible below the zones, opens its details, and returns to My zones when closed.");

    await deleteMockZone(page, "Вкъщи");
    await deleteMockZone(page, "Работа");
    await expect(page.getByText(/Нямаш добавени зони\. Натисни/)).toBeVisible();
    await expect(cityWideCard).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Добави зона", exact: true })).toBeEnabled();
    await expect.poll(() => mapFeatureCount(page)).toBe(0);
    await eventsMode.click();
    await expect(waterCard).toBeVisible();
    await expect(cityWideCard).toBeVisible();
    await expect.poll(() => mapFeatureCount(page)).toBeGreaterThan(0);
    assert.deepEqual(pageErrors, []);
    context.diagnostic("Narrow layout restored Events; deleting mock zones cleared the map; Events restored markers.");
  } catch (error) {
    await page.screenshot({
      path: path.join(artifactDirectory, "failure.png"),
      fullPage: true,
    });
    throw error;
  } finally {
    await browser.close();
  }
});
