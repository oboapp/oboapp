import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect } from "playwright/test";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3000";
const browserChannel = process.env.PLAYWRIGHT_CHANNEL;
const preferenceKey = "landingViewPreference:v2";
const artifactDirectory = fileURLToPath(
  new URL("../../tmp/preferred-landing-e2e/", import.meta.url),
);

function assertLocalTarget() {
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname),
    "Run these checks against a local MSW development server with a Google Maps key.",
  );
}

function isApiResponse(response, pathname, method = "GET") {
  return new URL(response.url()).pathname === pathname &&
    response.request().method() === method;
}

function eventCard(page, text) {
  return page.locator("button").filter({ hasText: text });
}

function tab(page, label) {
  return page.getByRole("radio", { name: label, exact: true });
}

function house(page, label, saved) {
  return page.getByRole("button", {
    name: saved
      ? "Информация за началния изглед „" + label + "“"
      : "Направи „" + label + "“ начален изглед",
    exact: true,
  });
}

async function expectHouse(page, label, saved) {
  await expect(house(page, label, saved)).toBeEnabled();
  await expect(house(page, label, saved)).not.toHaveAttribute("aria-disabled");
  await expect(page.getByRole("button", {
    name: /Информация за началния изглед|Направи .* начален изглед/,
  })).toHaveCount(1);
}

async function savedPreference(page) {
  return page.evaluate((key) => localStorage.getItem(key), preferenceKey);
}

async function preparePage(page, { legacyLocation = false } = {}) {
  page.setDefaultTimeout(30_000);
  await page.route("**/api/interests**", async (route) => {
    if (route.request().method() === "GET") {
      await route.continue();
    } else {
      // MSW handles mock writes before this route; block writes reaching the server.
      await route.abort("blockedbyclient");
    }
  });
  await page.addInitScript((preserveLegacyLocation) => {
    if (!sessionStorage.getItem("home-fixture-initialized")) {
      localStorage.removeItem("landingViewPreference:v1");
      localStorage.removeItem("geolocationPermissionGranted");
      localStorage.setItem("landingViewPreference:v2", "all");
      sessionStorage.setItem("home-fixture-initialized", "true");
    }
    if (preserveLegacyLocation) {
      localStorage.setItem("geolocationPermissionGranted", "true");
    }
    localStorage.setItem("categoryFilter", JSON.stringify({
      selectedCategories: [],
      hasInteracted: true,
      showArchived: true,
    }));

    if (sessionStorage.getItem("delay-landing-zones") === "true") {
      const originalFetch = globalThis.fetch;
      const zonesReady = new Promise((resolve) => {
        globalThis.__releaseLandingZones = resolve;
      });
      globalThis.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const input = args[0];
        const url = new URL(
          input instanceof Request ? input.url : input,
          location.href,
        );
        if (url.pathname === "/api/interests") {
          await zonesReady;
        }
        return response;
      };
    }
  }, legacyLocation);
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Не сега", exact: true }),
    async (button) => {
      await button.click();
    },
  );
}

async function openFixtures(page) {
  const [interests, messages] = await Promise.all([
    page.waitForResponse((response) => {
      return isApiResponse(response, "/api/interests");
    }, { timeout: 180_000 }),
    page.waitForResponse((response) => {
      return isApiResponse(response, "/api/messages");
    }, { timeout: 180_000 }),
    page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180_000 }),
  ]);
  assert.equal(interests.fromServiceWorker(), true);
  assert.equal(messages.fromServiceWorker(), true);
  const zones = (await interests.json()).interests;
  assert.deepEqual(zones.map((zone) => zone.id).sort(), [
    "interest-home", "interest-work",
  ]);
  assert.ok(zones.every((zone) => zone.userId === "mock-user-123"));
  return zones;
}

async function installCameraProbe(page) {
  await page.waitForFunction(() => {
    return typeof globalThis.google?.maps?.Map?.prototype.fitBounds === "function";
  }, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    const originalFitBounds = google.maps.Map.prototype.fitBounds;
    globalThis.__landingCamera = { map: null, zoneFits: [] };
    google.maps.Map.prototype.fitBounds = function (bounds, padding) {
      globalThis.__landingCamera.map = this;
      if (padding === 56) {
        globalThis.__landingCamera.zoneFits.push({ padding });
      }
      return originalFitBounds.call(this, bounds, padding);
    };
  });
}

async function expectInitialCircleFit(page, zones) {
  await expect.poll(async () => {
    return page.evaluate(() => globalThis.__landingCamera?.zoneFits.length);
  }).toBe(1);
  await expect.poll(async () => {
    return page.evaluate((savedZones) => {
      const state = globalThis.__landingCamera;
      const bounds = state.map.getBounds();
      if (!bounds || state.zoneFits[0].padding < 16) {
        return false;
      }
      return savedZones.every((zone) => {
        const circle = new google.maps.Circle({
          center: zone.coordinates,
          radius: zone.radius,
        }).getBounds();
        return bounds.contains(circle.getNorthEast()) &&
          bounds.contains(circle.getSouthWest());
      });
    }, zones);
  }, { timeout: 30_000 }).toBe(true);
}

async function openSettings(page) {
  await page.getByRole("button", { name: "Профилно меню", exact: true }).click();
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: "Начален изглед", exact: true,
  })).toBeVisible({ timeout: 90_000 });
  return page.getByRole("group", { name: "Избор на начален изглед", exact: true });
}

async function deleteMockZone(page, label) {
  await page.getByRole("button", { name: "Действия за " + label }).click();
  await page.getByRole("menuitem", { name: "Изтрий", exact: true }).click();
  const deleted = page.waitForResponse((response) => {
    return isApiResponse(response, "/api/interests", "DELETE");
  });
  await page.getByRole("button", { name: "Изтрий зоната", exact: true }).click();
  const response = await deleted;
  assert.equal(response.fromServiceWorker(), true);
  assert.equal(response.ok(), true);
  await expect(page.getByRole("button", {
    name: "Действия за " + label,
  })).toHaveCount(0);
}

test("the active tab's house saves home across visits, mobile layouts, and empty zones", {
  timeout: 480_000,
}, async (context) => {
  assertLocalTarget();
  const browser = await chromium.launch({ channel: browserChannel });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  const messageRequests = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/messages") {
      messageRequests.push(request.url());
    }
  });
  await mkdir(artifactDirectory, { recursive: true });
  try {
    await preparePage(page);
    const zones = await openFixtures(page);
    const allMode = tab(page, "Всички");
    const zonesMode = tab(page, "Моите зони");
    const roadCard = eventCard(page, "Затворена улица");
    const waterCard = eventCard(page, "Планирано спиране на водоподаването");
    await expect(allMode).toHaveAttribute("aria-checked", "true");
    await expect(tab(page, "Около мен")).toBeVisible();
    await expectHouse(page, "Всички", true);
    const homeToast = page.locator("[data-sonner-toast]").filter({
      hasText: /При следващото отваряне на OboApp|началният ти изглед в OboApp|Началният изглед не се запази/,
    });
    await expect(homeToast).toHaveCount(0);
    await expect(roadCard).toBeVisible();
    await installCameraProbe(page);

    await zonesMode.click();
    await expectHouse(page, "Моите зони", false);
    await expect(homeToast).toHaveCount(0);
    await expect(roadCard).toHaveCount(0);
    await expect(waterCard).toBeVisible();
    await expectInitialCircleFit(page, zones);
    await house(page, "Моите зони", false).click();
    await expectHouse(page, "Моите зони", true);
    await expect(homeToast).toContainText("При следващото отваряне на OboApp ще виждаш „Моите зони“.");
    await expect(homeToast).toHaveCount(1);
    assert.equal(await savedPreference(page), "zones");
    await house(page, "Моите зони", true).click();
    await expect(homeToast).toContainText("„Моите зони“ е началният ти изглед в OboApp.");
    await expect(homeToast).toHaveCount(1);
    assert.equal(await savedPreference(page), "zones");
    assert.equal(await page.evaluate(() => globalThis.__landingCamera.zoneFits.length), 1);

    await allMode.click();
    await expectHouse(page, "Всички", false);
    await expect(roadCard).toBeVisible();
    assert.equal(await savedPreference(page), "zones");
    await zonesMode.click();
    await expectHouse(page, "Моите зони", true);
    context.diagnostic("The house moves with the active tab; only its separate click saves home, and a filled house preserves the current choice.");

    await page.evaluate(() => {
      sessionStorage.setItem("delay-landing-zones", "true");
    });
    messageRequests.length = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      return typeof globalThis.__releaseLandingZones === "function";
    });
    await zonesMode.waitFor({ state: "visible" });
    await expect(page.getByText("Зареждане...", { exact: true })).toBeVisible();
    await expect(roadCard).toHaveCount(0);
    assert.equal(messageRequests.length, 0,
      "A zones home must wait for saved zones before fetching events.");
    await page.evaluate(() => {
      sessionStorage.removeItem("delay-landing-zones");
      globalThis.__releaseLandingZones();
    });
    await expect(zonesMode).toHaveAttribute("aria-checked", "true");
    await expectHouse(page, "Моите зони", true);
    await expect(waterCard).toBeVisible();

    await page.setViewportSize({ width: 320, height: 844 });
    await expect(allMode).toBeVisible();
    await expect(tab(page, "Около мен")).toBeVisible();
    await expect(zonesMode).toBeVisible();
    const tabRow = allMode.locator("..").locator("..");
    const tabBox = await tabRow.boundingBox();
    assert.ok(tabBox);
    assert.ok(tabBox.x >= 0 && tabBox.x + tabBox.width <= 321,
      "All labels and the active house must fit a 320px layout.");
    await expect(page.getByRole("button", {
      name: "Покажи моето местоположение", exact: true,
    })).toHaveCount(0);
    await allMode.click();
    await expectHouse(page, "Всички", false);
    assert.equal(await savedPreference(page), "zones");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(zonesMode).toHaveAttribute("aria-checked", "true");
    await expectHouse(page, "Моите зони", true);
    await expect(waterCard).toBeVisible();
    await page.screenshot({
      path: path.join(artifactDirectory, "mobile-zone-landing.png"),
      fullPage: true,
    });
    await page.getByRole("radiogroup", { name: "Изглед на събитията" }).screenshot({
      path: path.join(artifactDirectory, "three-tabs-house.png"),
    });
    context.diagnostic("The same three tabs and house work at 320px, survive reload, and wait for delayed zones.");

    await page.setViewportSize({ width: 1600, height: 1000 });
    await deleteMockZone(page, "Вкъщи");
    await deleteMockZone(page, "Работа");
    await expect(page.getByText(/Нямаш добавени зони\. Натисни/)).toBeVisible();
    const addZone = page.getByRole("button", { name: "Добави зона", exact: true });
    await expect(addZone).toBeEnabled();
    await expectHouse(page, "Моите зони", true);
    await expect(waterCard).toHaveCount(0);
    await addZone.click();
    await expect(page.getByText("Натисни на картата, за да поставиш зоната", {
      exact: true,
    })).toBeVisible();
    await page.getByRole("button", { name: "Отказ", exact: true }).click();
    await expect(addZone).toBeEnabled();
    assert.equal(await savedPreference(page), "zones");

    await page.goto(new URL("/?messageId=msg-water-center-1", baseUrl).href, {
      waitUntil: "domcontentloaded",
    });
    const details = page.getByRole("complementary", {
      name: "Детайли за сигнала", exact: true,
    });
    await expect(details).toBeVisible();
    await expect(details).toContainText("Граф Игнатиев");
    await expect(allMode).toHaveAttribute("aria-checked", "true");
    assert.equal(await savedPreference(page), "zones");
    await details.getByRole("button", { name: "Затвори детайлите", exact: true }).click();
    await expect(details).toHaveCount(0);

    const choices = await openSettings(page);
    await expect(choices.getByRole("radio")).toHaveCount(3);
    await expect(choices.getByRole("radio", { name: "Моите зони", exact: true })).toBeChecked();
    await choices.getByRole("radio", { name: "Всички", exact: true }).check();
    assert.equal(await savedPreference(page), "all");
    await page.getByRole("link", { name: /Начало$/ }).click();
    await expect(allMode).toHaveAttribute("aria-checked", "true");
    await expectHouse(page, "Всички", true);
    await zonesMode.click();
    await expectHouse(page, "Моите зони", false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(allMode).toHaveAttribute("aria-checked", "true");
    await expect(roadCard).toBeVisible();
    assert.equal(await savedPreference(page), "all");
    assert.deepEqual(pageErrors, []);
    context.diagnostic("Empty zones keep creation primary and home intact; direct links preserve details; Settings shares all three home choices.");
  } catch (error) {
    await page.screenshot({ path: path.join(artifactDirectory, "failure.png"), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
});

test("Nearby handles native permission, retry, home intent, and late fixes without changing another home", {
  timeout: 300_000,
}, async (context) => {
  assertLocalTarget();
  const browser = await chromium.launch({ channel: browserChannel });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await mkdir(artifactDirectory, { recursive: true });
  try {
    await preparePage(page, { legacyLocation: true });
    await page.addInitScript(() => {
      globalThis.__landingGeo = {
        requests: [],
        permission: sessionStorage.getItem("home-location-permission") || "prompt",
        watches: 0,
        cleared: 0,
      };
      const originalQuery = navigator.permissions?.query.bind(navigator.permissions);
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          async query(descriptor) {
            if (descriptor.name === "geolocation") {
              return { state: globalThis.__landingGeo.permission };
            }
            return originalQuery ? originalQuery(descriptor) : { state: "granted" };
          },
        },
      });
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(success, failure) {
            globalThis.__landingGeo.requests.push({ success, failure });
          },
          watchPosition() {
            globalThis.__landingGeo.watches += 1;
            return globalThis.__landingGeo.watches;
          },
          clearWatch() {
            globalThis.__landingGeo.cleared += 1;
          },
        },
      });
    });
    await openFixtures(page);
    const allMode = tab(page, "Всички");
    const nearbyMode = tab(page, "Около мен");
    const zonesMode = tab(page, "Моите зони");
    const roadCard = eventCard(page, "Затворена улица");
    const waterCard = eventCard(page, "Планирано спиране на водоподаването");
    await expect(allMode).toHaveAttribute("aria-checked", "true");
    assert.equal(await page.evaluate(() => globalThis.__landingGeo.requests.length), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("geolocationPermissionGranted")), "true");
    await installCameraProbe(page);

    await nearbyMode.click();
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingGeo.requests.length);
    }).toBe(1);
    await page.evaluate(() => {
      globalThis.__landingGeo.requests[0].failure({ code: 1, message: "Denied" });
    });
    await expect(nearbyMode).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/Достъпът до местоположението е отказан/)).toBeVisible();
    await expect(roadCard).toHaveCount(0);
    await expect(waterCard).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Опитай отново", exact: true })).toBeVisible();
    assert.equal(await savedPreference(page), "all");

    await page.evaluate(() => {
      globalThis.__landingGeo.permission = "granted";
    });
    await page.getByRole("button", { name: "Опитай отново", exact: true }).click();
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingGeo.requests.length);
    }).toBe(2);
    await page.evaluate(() => {
      globalThis.__landingGeo.requests[1].success({
        coords: { latitude: 42.6977, longitude: 23.3219 },
      });
    });
    await expect(page.getByRole("button", {
      name: "Обнови местоположението", exact: true,
    })).toBeVisible();
    await expect(waterCard).toBeVisible();
    await expectHouse(page, "Около мен", false);
    assert.equal(await savedPreference(page), "all");
    await house(page, "Около мен", false).click();
    assert.equal(await savedPreference(page), "nearby");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(nearbyMode).toHaveAttribute("aria-checked", "true");
    await expectHouse(page, "Около мен", true);
    await expect(page.getByRole("button", {
      name: "Разреши местоположение", exact: true,
    })).toBeVisible();
    assert.equal(await page.evaluate(() => globalThis.__landingGeo.requests.length), 0,
      "A Nearby home must wait for an explicit action when permission is not granted.");
    await expect(waterCard).toHaveCount(0);
    await page.getByRole("button", { name: "Разреши местоположение", exact: true }).click();
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingGeo.requests.length);
    }).toBe(1);
    await page.evaluate(() => {
      globalThis.__landingGeo.requests[0].success({
        coords: { latitude: 42.6977, longitude: 23.3219 },
      });
    });
    await expect(waterCard).toBeVisible();
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingGeo.watches);
    }).toBeGreaterThan(0);

    await waterCard.click();
    const nearbyDetails = page.getByRole("complementary", { name: "Детайли за сигнала", exact: true });
    await expect(nearbyDetails).toBeVisible();
    await expect(page.getByRole("button", { name: "Обнови местоположението", exact: true })).toBeVisible();
    await nearbyDetails.getByRole("button", { name: "Затвори детайлите", exact: true }).click();
    await expect(waterCard).toBeVisible();
    assert.equal(await page.evaluate(() => globalThis.__landingGeo.requests.length), 1);

    await page.getByRole("button", { name: "Обнови местоположението", exact: true }).click();
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingGeo.requests.length);
    }).toBe(2);
    await page.evaluate(() => {
      globalThis.__landingGeo.requests[1].success({
        coords: { latitude: 42.6977, longitude: 23.3219 },
      });
    });
    await expect(waterCard).toBeVisible();
    await expect(page.getByRole("button", { name: "Обнови местоположението", exact: true })).toBeVisible();

    await installCameraProbe(page);
    await page.getByRole("button", { name: "Обнови местоположението", exact: true }).click();
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingGeo.requests.length);
    }).toBe(3);
    await zonesMode.click();
    await expect(waterCard).toBeVisible();
    await expectHouse(page, "Моите зони", false);
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingGeo.cleared);
    }).toBeGreaterThan(0);
    await expect.poll(async () => {
      return page.evaluate(() => globalThis.__landingCamera.zoneFits.length);
    }).toBe(1);
    let previousCamera = null;
    let stableChecks = 0;
    await expect.poll(async () => {
      const camera = await page.evaluate(() => {
        const map = globalThis.__landingCamera.map;
        return JSON.stringify({ center: map.getCenter().toJSON(), zoom: map.getZoom() });
      });
      stableChecks = camera === previousCamera ? stableChecks + 1 : 0;
      previousCamera = camera;
      return stableChecks >= 5;
    }, { intervals: [100] }).toBe(true);
    await page.evaluate(() => {
      globalThis.__landingGeo.requests[2].success({
        coords: { latitude: 42.75, longitude: 23.45 },
      });
    });
    let unchangedChecks = 0;
    await expect.poll(async () => {
      const actual = await page.evaluate(() => {
        const map = globalThis.__landingCamera.map;
        return JSON.stringify({ center: map.getCenter().toJSON(), zoom: map.getZoom() });
      });
      if (actual !== previousCamera) {
        return false;
      }
      unchangedChecks += 1;
      return unchangedChecks >= 5;
    }, { intervals: [100] }).toBe(true);
    assert.equal(await savedPreference(page), "nearby");

    await allMode.click();
    await expectHouse(page, "Всички", false);
    await house(page, "Всички", false).click();
    assert.equal(await savedPreference(page), "all");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(allMode).toHaveAttribute("aria-checked", "true");
    await expect(roadCard).toBeVisible();
    assert.equal(await page.evaluate(() => globalThis.__landingGeo.requests.length), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("geolocationPermissionGranted")), "true");
    assert.deepEqual(pageErrors, []);
    context.diagnostic("Explicit All overrides legacy consent; Nearby failures hide unrelated cards, retry works, startup permission waits for a click, and leaving Nearby ignores late fixes and stops tracking.");
  } catch (error) {
    await page.screenshot({ path: path.join(artifactDirectory, "nearby-failure.png"), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
});
