import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { getBoundsForLocality } from "@oboapp/shared";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3000";
const browserChannel = process.env.PLAYWRIGHT_CHANNEL;
const localityBounds = getBoundsForLocality("bg.sofia");
const artifactDirectory = fileURLToPath(
  new URL("../../tmp/my-zones-camera-e2e/", import.meta.url),
);

function isApiResponse(response, pathname, method = "GET") {
  return (
    new URL(response.url()).pathname === pathname &&
    response.request().method() === method
  );
}

async function cameraSnapshot(page) {
  return page.evaluate(() => {
    const state = globalThis.__zoneCamera;
    const map = state.map;
    return {
      center: map.getCenter().toJSON(),
      zoom: map.getZoom(),
      bounds: map.getBounds().toJSON(),
      fits: state.fits.length,
    };
  });
}

async function expectCameraUnchanged(page, expected) {
  let stableChecks = 0;
  await expect.poll(async () => {
    const actual = await cameraSnapshot(page);
    const unchanged = (
      Math.abs(actual.center.lat - expected.center.lat) < 0.000001 &&
      Math.abs(actual.center.lng - expected.center.lng) < 0.000001 &&
      actual.zoom === expected.zoom &&
      actual.fits === expected.fits
    );
    stableChecks = unchanged ? stableChecks + 1 : 0;
    return stableChecks >= 5;
  }, { intervals: [100] }).toBe(true);
}

async function expectNoMessageRefresh(requests, previousCount) {
  assert.ok(previousCount > 0, "Initial message requests must be observable.");
  let stableChecks = 0;
  await expect.poll(() => {
    if (requests.length !== previousCount) {
      return false;
    }

    stableChecks += 1;
    return stableChecks >= 6;
  }, { intervals: [100] }).toBe(true);
}

async function waitForCameraStable(page) {
  let previous = null;
  let stableChecks = 0;
  await expect.poll(async () => {
    const camera = await cameraSnapshot(page);
    const current = JSON.stringify(camera);
    stableChecks = current === previous ? stableChecks + 1 : 0;
    previous = current;
    return stableChecks >= 5;
  }, { intervals: [100] }).toBe(true);
}

async function moveCamera(page, center, zoom) {
  await page.evaluate(async ({ center: nextCenter, zoom: nextZoom }) => {
    const map = globalThis.__zoneCamera.map;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        listener.remove();
        reject(new Error("The Google Maps camera did not become idle."));
      }, 15_000);
      const listener = map.addListener("idle", () => {
        clearTimeout(timeout);
        listener.remove();
        resolve();
      });
      map.setOptions({ center: nextCenter, zoom: nextZoom });
    });
  }, { center, zoom });
}

async function expectLocalityLimits(page) {
  await expect.poll(async () => {
    return page.evaluate((expected) => {
      const map = globalThis.__zoneCamera.map;
      const restriction = map.get("restriction");
      if (!restriction?.strictBounds || !restriction.latLngBounds) {
        return false;
      }

      const configured = new google.maps.LatLngBounds(
        restriction.latLngBounds,
      ).toJSON();
      const viewport = map.getBounds().toJSON();
      const tolerance = 0.000001;
      return (
        Object.entries(expected).every(([side, value]) => {
          return Math.abs(configured[side] - value) < tolerance;
        }) &&
        map.get("minZoom") === 12 &&
        map.get("maxZoom") === 18 &&
        map.getZoom() >= 12 &&
        map.getZoom() <= 18 &&
        viewport.north <= expected.north + tolerance &&
        viewport.south >= expected.south - tolerance &&
        viewport.east <= expected.east + tolerance &&
        viewport.west >= expected.west - tolerance
      );
    }, localityBounds);
  }).toBe(true);
}

async function expectBoundedZoneFit(page, zones, previousFits) {
  await expect.poll(async () => {
    return (await cameraSnapshot(page)).fits;
  }).toBe(previousFits + 1);
  await waitForCameraStable(page);
  await expectLocalityLimits(page);
  await expect.poll(async () => {
    return page.evaluate((savedZones) => {
      const requested = new google.maps.LatLngBounds(
        globalThis.__zoneCamera.fits.at(-1).bounds,
      );
      return savedZones.every((zone) => {
        const circle = new google.maps.Circle({
          center: zone.coordinates,
          radius: zone.radius,
        }).getBounds();
        return requested.contains(circle.getNorthEast()) &&
          requested.contains(circle.getSouthWest());
      });
    }, zones);
  }).toBe(true);
}

async function expectZonesFitted(page, zones, previousFits) {
  await expect.poll(async () => {
    return (await cameraSnapshot(page)).fits;
  }).toBe(previousFits + 1);
  await waitForCameraStable(page);

  // Check actual projected circles against the visible map, independently of
  // the application's bounds helper. Google Maps also supplies the circle bounds.
  await expect.poll(async () => {
    return page.evaluate((savedZones) => {
      const state = globalThis.__zoneCamera;
      const map = state.map;
      const bounds = map.getBounds();
      const projection = map.getProjection();
      if (!bounds || !projection) {
        return false;
      }

      const padding = state.fits.at(-1).padding;
      const sides = typeof padding === "number"
        ? { top: padding, right: padding, bottom: padding, left: padding }
        : padding;
      if (!sides || Object.values(sides).some((value) => value < 16)) {
        return false;
      }

      const center = projection.fromLatLngToPoint(map.getCenter());
      const scale = 2 ** map.getZoom();
      const width = map.getDiv().clientWidth;
      const height = map.getDiv().clientHeight;
      return savedZones.every((zone) => {
        const circle = new google.maps.Circle({
          center: zone.coordinates,
          radius: zone.radius,
        });
        const circleBounds = circle.getBounds();
        const northEast = circleBounds.getNorthEast();
        const southWest = circleBounds.getSouthWest();
        if (!bounds.contains(northEast) || !bounds.contains(southWest)) {
          return false;
        }

        const northEastPoint = projection.fromLatLngToPoint(northEast);
        const southWestPoint = projection.fromLatLngToPoint(southWest);
        const left = (southWestPoint.x - center.x) * scale + width / 2;
        const right = (northEastPoint.x - center.x) * scale + width / 2;
        const top = (northEastPoint.y - center.y) * scale + height / 2;
        const bottom = (southWestPoint.y - center.y) * scale + height / 2;
        const tolerance = 2;
        return (
          left >= sides.left - tolerance &&
          right <= width - sides.right + tolerance &&
          top >= sides.top - tolerance &&
          bottom <= height - sides.bottom + tolerance
        );
      });
    }, zones);
  }, { timeout: 30_000 }).toBe(true);
}

async function moveMockZone(page, zone, coordinates) {
  await page.getByRole("button", { name: `Действия за ${zone.label}` }).click();
  await page.getByRole("menuitem", { name: "Премести", exact: true }).click();
  const save = page.getByRole("button", { name: "Запази зоната", exact: true });
  await expect(save).toBeEnabled();
  await moveCamera(page, coordinates, 16);
  // Place the mock zone through Maps' native click event for deterministic setup.
  await page.evaluate((position) => {
    google.maps.event.trigger(globalThis.__zoneCamera.map, "click", {
      latLng: new google.maps.LatLng(position),
    });
  }, coordinates);
  await expect.poll(async () => {
    const placement = await page.getByText(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/)
      .textContent();
    const [latitude, longitude] = (placement || "").split(",").map(Number);
    return Math.abs(latitude - coordinates.lat) < 0.0001 &&
      Math.abs(longitude - coordinates.lng) < 0.0001;
  }).toBe(true);
  const saved = page.waitForResponse((response) => {
    return isApiResponse(response, "/api/interests", "PATCH");
  });
  await save.click();
  const response = await saved;
  assert.equal(response.fromServiceWorker(), true);
  assert.equal(response.ok(), true);
  const data = await response.json();
  assert.equal(data.interest.id, zone.id);
  assert.equal(data.interest.userId, "mock-user-123");
  assert.ok(Math.abs(data.interest.coordinates.lat - coordinates.lat) < 0.0001);
  assert.ok(Math.abs(data.interest.coordinates.lng - coordinates.lng) < 0.0001);
  await expect(save).toHaveCount(0);
  return data.interest;
}

async function deleteMockZone(page, zone) {
  await page.getByRole("button", { name: `Действия за ${zone.label}` }).click();
  await page.getByRole("menuitem", { name: "Изтрий", exact: true }).click();
  const deleted = page.waitForResponse((response) => {
    return isApiResponse(response, "/api/interests", "DELETE");
  });
  await page.getByRole("button", { name: "Изтрий зоната", exact: true }).click();
  const response = await deleted;
  assert.equal(response.fromServiceWorker(), true);
  assert.equal(response.ok(), true);
  await expect(
    page.getByRole("button", { name: `Действия за ${zone.label}` }),
  ).toHaveCount(0);
}

test("My zones fits saved circles once per entry and preserves later camera changes", {
  timeout: 300_000,
}, async (context) => {
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname),
    "Run this test against a local MSW development server with a Google Maps key.",
  );
  const browser = await chromium.launch({ channel: browserChannel });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  const messageRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/messages") {
      messageRequests.push(request.url());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await mkdir(artifactDirectory, { recursive: true });

  try {
    // MSW handles mock mutations before Playwright routing. Block any mutation
    // that falls through to the server if the browser worker stops handling it.
    await page.route("**/api/interests**", async (route) => {
      if (route.request().method() === "GET") {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem("categoryFilter", JSON.stringify({
        selectedCategories: [],
        hasInteracted: true,
        showArchived: true,
      }));
      localStorage.setItem("geolocationPermissionGranted", "true");
      globalThis.__cameraGeolocation = { resolve: null };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(success) {
            globalThis.__cameraGeolocation.resolve = success;
          },
          watchPosition() {
            return 1;
          },
          clearWatch() {},
        },
      });
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
      "MSW must serve the known fixtures before the test edits zones.");
    assert.equal(messages.fromServiceWorker(), true);
    let zones = (await interests.json()).interests;
    assert.deepEqual(zones.map((zone) => zone.id).sort(), [
      "interest-home", "interest-work",
    ]);
    assert.ok(zones.every((zone) => zone.userId === "mock-user-123"));
    assert.deepEqual(zones.map((zone) => zone.radius).sort(), [500, 800]);

    await page.addLocatorHandler(
      page.getByRole("button", { name: "Не сега", exact: true }),
      async (button) => {
        await button.click();
      },
    );
    await page.waitForFunction(() => {
      return typeof globalThis.google?.maps?.Map?.prototype.fitBounds === "function" &&
        globalThis.__cameraGeolocation.resolve !== null;
    }, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const original = google.maps.Map.prototype.fitBounds;
      globalThis.__zoneCamera = { map: null, fits: [] };
      google.maps.Map.prototype.fitBounds = function (bounds, padding) {
        globalThis.__zoneCamera.map = this;
        globalThis.__zoneCamera.fits.push({
          padding,
          bounds: new google.maps.LatLngBounds(bounds).toJSON(),
        });
        return original.call(this, bounds, padding);
      };
    });

    const zonesMode = page.getByRole("radio", { name: "Моите зони" });
    const eventsMode = page.getByRole("radio", { name: "Събития" });
    await page.getByRole("button", { name: "Отвори филтрите", exact: true }).click();
    await zonesMode.click();
    await expect(page.getByRole("button", {
      name: "Отвори филтрите", exact: true,
    })).toBeVisible();
    await page.waitForFunction(() => globalThis.__zoneCamera.map !== null);
    await expectZonesFitted(page, zones, 0);
    await expect(page.getByText("Зареждане...", { exact: true })).toHaveCount(0, {
      timeout: 60_000,
    });
    const zoneEvents = page.getByRole("region", { name: "Събития в моите зони", exact: true });
    const zoneTextBeforeMovement = await zoneEvents.innerText();
    const requestsBeforeMovement = messageRequests.length;
    await expectLocalityLimits(page);
    await moveCamera(page, { lat: 41, lng: 26 }, 15);
    await expectLocalityLimits(page);
    await moveCamera(page, { lat: 42.7, lng: 23.3 }, 0);
    await expectLocalityLimits(page);
    context.diagnostic("Both native zone circles fit inside the visible map with padding.");
    context.diagnostic("My zones keeps the normal locality bounds when panning outside Sofia and requesting a world zoom.");

    await moveCamera(page, { lat: 42.69, lng: 23.34 }, 15);
    const manualCamera = await cameraSnapshot(page);
    await page.evaluate(() => {
      globalThis.__cameraGeolocation.resolve({
        coords: { latitude: 42.75, longitude: 23.45 },
      });
    });
    await expectCameraUnchanged(page, manualCamera);
    await expectLocalityLimits(page);
    await expectNoMessageRefresh(messageRequests, requestsBeforeMovement);
    assert.equal(await zoneEvents.innerText(), zoneTextBeforeMovement);
    await expect(page.getByText("Зареждане...", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Отвори филтрите", exact: true }).click();
    const waterCategory = page.getByRole("region", { name: "Категории" })
      .getByRole("button", { name: /^Вода\s*\d*$/ });
    const categoryResponse = page.waitForResponse((response) => {
      return isApiResponse(response, "/api/messages") &&
        new URL(response.url()).searchParams.get("categories") === "water";
    });
    await waterCategory.click();
    assert.equal((await categoryResponse).fromServiceWorker(), true);
    await expect(waterCategory).toHaveAttribute("aria-pressed", "true");
    await expectCameraUnchanged(page, manualCamera);
    await page.getByRole("button", { name: "Затвори филтрите", exact: true }).click();
    context.diagnostic("Map movement keeps My zones records and request count stable; category refresh and late geolocation preserve manual camera.");

    await eventsMode.click();
    await expectLocalityLimits(page);
    await zonesMode.click();
    await expectZonesFitted(page, zones, manualCamera.fits);

    // Extreme spreads request all circles while respecting the locality camera.
    zones = [
      await moveMockZone(page, zones[0], { lat: 42.615, lng: 23.205 }),
      await moveMockZone(page, zones[1], { lat: 42.82, lng: 23.51 }),
    ];
    const beforeWideFit = await cameraSnapshot(page);
    await eventsMode.click();
    await zonesMode.click();
    await expectBoundedZoneFit(page, zones, beforeWideFit.fits);
    await expect.poll(async () => (await cameraSnapshot(page)).zoom).toBeLessThan(16);
    await page.screenshot({ path: path.join(artifactDirectory, "distant-zones.png") });
    context.diagnostic("Fitting distant zones at opposite locality edges preserves the normal map limits.");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(zonesMode).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Събития", exact: true })).toBeVisible();
    const beforeResponsiveEntry = await cameraSnapshot(page);
    await page.setViewportSize({ width: 1280, height: 960 });
    await expect(zonesMode).toHaveAttribute("aria-checked", "true");
    await expectBoundedZoneFit(page, zones, beforeResponsiveEntry.fits);

    await deleteMockZone(page, zones[1]);
    zones = [zones[0]];
    const beforeSingleFit = await cameraSnapshot(page);
    await eventsMode.click();
    await zonesMode.click();
    await expectZonesFitted(page, zones, beforeSingleFit.fits);
    await expectLocalityLimits(page);
    context.diagnostic("Returning to desktop keeps the locality boundary; one remaining zone fits fully.");

    await deleteMockZone(page, zones[0]);
    await expect(page.getByText(/Нямаш добавени зони\. Натисни/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Добави зона", exact: true })).toBeEnabled();
    await eventsMode.click();
    const emptyCamera = await cameraSnapshot(page);
    await zonesMode.click();
    await expectCameraUnchanged(page, emptyCamera);
    await expectLocalityLimits(page);
    await page.screenshot({ path: path.join(artifactDirectory, "no-zones.png") });
    assert.deepEqual(pageErrors, []);
    context.diagnostic("Entering My zones without saved zones keeps the camera and add-zone action usable.");
  } catch (error) {
    const cameraReady = await page.evaluate(() => {
      return Boolean(globalThis.__zoneCamera?.map);
    }).catch(() => false);
    if (cameraReady) {
      context.diagnostic(JSON.stringify(await cameraSnapshot(page)));
      context.diagnostic(JSON.stringify(await page.evaluate(() => {
        return globalThis.__zoneCamera.fits.at(-1);
      })));
    }
    await page.screenshot({
      path: path.join(artifactDirectory, "failure.png"),
      fullPage: true,
    });
    throw error;
  } finally {
    await browser.close();
  }
});
