// @vitest-environment node

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-erm-zapad/metadata";
import sourceDefinition from "../../../shared/src/sources/erm-zapad";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

interface Municipality {
  code: string;
  name: string;
}

interface Incident {
  ceo: string;
  lat: string;
  lon: string;
  typedist: string;
  type_event: string;
  begin_event?: string;
  end_event?: string;
  city_name?: string;
  grid_id: string;
  cities?: string;
  points: Record<string, unknown>;
}

interface ProviderFixture {
  municipalities: Municipality[];
  responses: Record<string, Record<string, Incident>>;
}

interface FrozenIncident {
  identifier: string;
  content: {
    title: string;
    message: string;
    markdownText: string;
    datePublished: string;
    deepLinkUrl: string;
    geoJson: string;
    categories: string[];
    isRelevant: boolean;
    timespanStart: string;
    timespanEnd: string;
  };
}

function readFixture(name: string): string {
  return readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
}

// These literal expectations were frozen independently from the legacy collector.
const providerFixture = JSON.parse(readFixture("provider.json")) as ProviderFixture;
const expectedIncidents = JSON.parse(readFixture("expected.json")) as FrozenIncident[];
const lowerIncident = expectedIncidents[0];
const groupedIncident = expectedIncidents[1];
const lowerId = "d1f40475241a7e9dc3f71ffb566aab87";
const lowerLegacyId = "aHR0cHM6Ly9pbmZvLmVybXphcGFkLmJnL2luY2lkZW50cy9TRl8wMDAx";
const groupedId = "413fca0da64836ec11c6fddd711b8f28";
const groupedLegacyId = "aHR0cHM6Ly9pbmZvLmVybXphcGFkLmJnL2luY2lkZW50cy9TRl8wMDEw";
let store: ReturnType<typeof createSourceStore>;
let municipalities: Municipality[];
let responses: ProviderFixture["responses"];
let fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

function listingHtml(items: Municipality[]): string {
  const rows = items.map((item) => {
    return `<li onclick="show_obstina('${item.code}','SOF'); this.disabled = true;">община ${item.name}<div id="${item.code}"></div></li>`;
  });
  return `<html><body><div class="card-body"><h5 class="card-title">Област София-град</h5><ul class="list-group">${rows.join("")}</ul></div></body></html>`;
}

async function respondToProvider(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(input) !== metadata.url) {
    throw new Error(`Unexpected detail request: ${String(input)}`);
  }
  if (init?.method !== "POST") {
    return new Response(listingHtml(municipalities));
  }
  if (typeof init.body !== "string") {
    throw new Error("Expected URL-encoded municipality request");
  }
  const form = new URLSearchParams(init.body);
  const code = form.get("gm_obstina");
  if (!code || !responses[code]) {
    throw new Error(`Unexpected municipality: ${code}`);
  }
  // The real provider labels its BOM-prefixed JSON response as HTML.
  return new Response("\uFEFF" + JSON.stringify(responses[code]), {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

function expectedRaw(incident: FrozenIncident): Record<string, unknown> {
  return {
    ...incident.content,
    url: incident.identifier,
    sourceType: "erm-zapad",
    locality: "bg.sofia",
    timespanStart: new Date(incident.content.timespanStart),
    timespanEnd: new Date(incident.content.timespanEnd),
    crawledAt: contractDate,
    processed: false,
  };
}

function expectClosedRequests(): void {
  for (const [, options] of fetchMock.mock.calls) {
    expect(options?.signal?.aborted).toBe(true);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  vi.stubEnv("TZ", "UTC");
  store = createSourceStore();
  municipalities = [{ code: "SOF2", name: "ВТОРИ РАЙОН" }];
  responses = {
    SOF2: { lower: structuredClone(providerFixture.responses.SOF2.lower) },
  };
  fetchMock = vi.fn<typeof globalThis.fetch>(respondToProvider);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockReset().mockResolvedValue({
    messages: [],
    totalCategorized: 0,
    totalRelevant: 0,
    totalIrrelevant: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("published ERM Zapad package to ingestion", () => {
  it("keeps the catalog identity and emergent classification", () => {
    expect(metadata).toEqual(sourceDefinition);
    expect(metadata).toEqual({
      id: "erm-zapad",
      name: "ЕРМ Запад",
      url: "https://info.ermzapad.bg/webint/vok/avplan.php",
      localities: ["bg.sofia"],
      emergent: true,
    });
  });

  it("persists complete HTTP content and passes exact geometry, dates and disabled link to ingestion", async () => {
    await crawl();

    expect(lowerIncident.identifier).toBe("https://info.ermzapad.bg/incidents/SF_0001");
    expect(store.records.get(lowerId)).toEqual(expectedRaw(lowerIncident));
    expect(store.client.createOne).toHaveBeenCalledExactlyOnceWith("sources", expectedRaw(lowerIncident), lowerId);
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(await ingest({ sourceType: metadata.id, limit: 10 })).toMatchObject({
      total: 1,
      ingested: 1,
      failed: 0,
    });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(lowerIncident.content.message, "erm-zapad", {
      precomputedGeoJson: JSON.parse(lowerIncident.content.geoJson),
      sourceUrl: undefined,
      sourceDocumentId: lowerId,
      boundaryFilter: undefined,
      crawledAt: contractDate,
      datePublished: "2026-10-04T10:00:00.000Z",
      markdownText: lowerIncident.content.markdownText,
      categories: ["electricity"],
      isRelevant: true,
      timespanStart: new Date("2026-10-04T10:00:00.000Z"),
      timespanEnd: new Date("2026-10-04T12:00:00.000Z"),
      cityWide: undefined,
      locality: "bg.sofia",
    });

    // Completion belongs to the downstream pipeline beyond this handoff.
    await store.sources.updateOne(lowerId, { processed: true });
    const completed = store.records.get(lowerId);
    await crawl();

    expect(store.records.get(lowerId)).toBe(completed);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect((await ingest({ sourceType: metadata.id })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual([
      "GET", "POST", "GET", "POST",
    ]);
    expectClosedRequests();
  });

  it("chooses the lowest ID across municipalities before persisting grouped center points", async () => {
    municipalities = structuredClone(providerFixture.municipalities);
    responses = structuredClone(providerFixture.responses);

    await crawl();

    expect(store.records.size).toBe(2);
    expect(store.records.get(lowerId)).toEqual(expectedRaw(lowerIncident));
    expect(store.records.get(groupedId)).toEqual(expectedRaw(groupedIncident));
    expect([...store.records.values()].map((record) => record.url)).toEqual([
      "https://info.ermzapad.bg/incidents/SF_0001",
      "https://info.ermzapad.bg/incidents/SF_0010",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.invocationCallOrder[2]).toBeLessThan(store.client.createOne.mock.invocationCallOrder[0]);
    expectClosedRequests();
  });

  it.each([
    { id: lowerId, processed: false },
    { id: lowerId, processed: true },
    { id: lowerLegacyId, processed: false },
    { id: lowerLegacyId, processed: true },
    { id: groupedId, processed: false },
    { id: groupedId, processed: true },
    { id: groupedLegacyId, processed: false },
    { id: groupedLegacyId, processed: true },
  ])("preserves historical $id with processed=$processed", async ({ id, processed }) => {
    const incident = id === groupedId || id === groupedLegacyId ? groupedIncident : lowerIncident;
    if (incident === groupedIncident) {
      responses.SOF2 = {
        grouped: structuredClone(providerFixture.responses.SOF1.grouped),
        secondPoint: structuredClone(providerFixture.responses.SOF2.secondPoint),
      };
    }
    const historical = { url: incident.identifier, title: "Historical content", processed };
    store.records.set(id, historical);

    await crawl();

    expect(store.records.size).toBe(1);
    expect(store.records.get(id)).toBe(historical);
    expect(store.sources.findById).toHaveBeenCalledWith(id);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: "erm-zapad", saved: 0, skipped: 1, failed: 0,
    });
    expectClosedRequests();
  });

  it.each([false, true])("keeps existing content and processed=%s when provider fields change", async (processed) => {
    await crawl();
    await store.sources.updateOne(lowerId, { processed });
    const historical = store.records.get(lowerId);
    responses.SOF2.lower.end_event = "04.10.2026 20:00";
    responses.SOF2.lower.city_name = "Обновено място";

    await crawl();

    expect(store.records.get(lowerId)).toBe(historical);
    expect(store.records.get(lowerId)?.processed).toBe(processed);
    expect(store.records.size).toBe(1);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
  });

  it("continues after a write failure and retries only the missing complete incident", async () => {
    responses.SOF2.grouped = structuredClone(providerFixture.responses.SOF1.grouped);
    responses.SOF2.secondPoint = structuredClone(providerFixture.responses.SOF2.secondPoint);
    store.client.createOne.mockRejectedValueOnce(new Error("Storage unavailable"));

    await crawl();

    expect(store.records.size).toBe(1);
    expect(store.records.get(groupedId)).toEqual(expectedRaw(groupedIncident));
    expect(store.records.has(lowerId)).toBe(false);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: "erm-zapad", saved: 1, skipped: 0, failed: 1,
    });

    const saved = store.records.get(groupedId);
    await crawl();

    expect(store.records.size).toBe(2);
    expect(store.records.get(lowerId)).toEqual(expectedRaw(lowerIncident));
    expect(store.records.get(groupedId)).toBe(saved);
    expect(store.client.createOne).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: "erm-zapad", saved: 1, skipped: 1, failed: 0,
    });
    expectClosedRequests();
  });

  it("signals a completely failed write without exposing partial content to ingestion", async () => {
    store.client.createOne.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(crawl()).rejects.toThrow("All ERM Zapad incidents failed to process");

    expect(store.records.size).toBe(0);
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 0, ingested: 0 });
    expect(messageIngest).not.toHaveBeenCalled();
    expectClosedRequests();

    await crawl();

    expect(store.records.get(lowerId)).toEqual(expectedRaw(lowerIncident));
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
  });

  it("keeps historical content after a lookup failure and skips it on retry", async () => {
    const historical = { url: lowerIncident.identifier, title: "Historical content", processed: true };
    store.records.set(lowerId, historical);
    store.sources.findById.mockRejectedValueOnce(new Error("Lookup unavailable"));

    await expect(crawl()).rejects.toThrow("All ERM Zapad incidents failed to process");
    await crawl();

    expect(store.records.size).toBe(1);
    expect(store.records.get(lowerId)).toBe(historical);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expectClosedRequests();
  });

  it.each(["GET HTTP", "GET network", "POST HTTP", "POST network", "POST JSON"])(
    "retries failed %s discovery without writing partial records",
    async (stage) => {
      const failRequest = async (): Promise<Response> => {
        if (stage.endsWith("network")) {
          throw new Error("Network unavailable");
        }
        if (stage.endsWith("JSON")) {
          return new Response("<html>Provider unavailable</html>");
        }
        return new Response("Unavailable", { status: 503 });
      };
      if (stage.startsWith("POST")) {
        fetchMock.mockImplementationOnce(respondToProvider);
      }
      fetchMock.mockImplementationOnce(failRequest);

      await expect(crawl()).rejects.toThrow();

      expect(store.records.size).toBe(0);
      expect(store.client.createOne).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith("Crawl complete", expect.anything());
      expectClosedRequests();

      await crawl();

      expect(store.records.get(lowerId)).toEqual(expectedRaw(lowerIncident));
      expect(store.client.createOne).toHaveBeenCalledOnce();
      expectClosedRequests();
    },
  );

  it("keeps a valid empty municipality listing empty", async () => {
    municipalities = [];

    await crawl();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: "erm-zapad", saved: 0, skipped: 0, failed: 0,
    });
    expectClosedRequests();
  });

  it("skips the provider's inactive-municipality placeholder and invalid coordinates", async () => {
    fetchMock.mockImplementationOnce(respondToProvider).mockResolvedValueOnce(new Response(
      "\uFEFF" + JSON.stringify({
        placeholder: { cities: "" },
        invalid: { ...responses.SOF2.lower, lat: "invalid", lon: "invalid" },
      }),
    ));

    await crawl();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: "erm-zapad", saved: 0, skipped: 0, failed: 0,
    });
    expectClosedRequests();
  });

  it("preserves first-pin metadata when only a later point has valid coordinates", async () => {
    responses.SOF2 = {
      invalidFirst: {
        ...providerFixture.responses.SOF2.lower,
        lat: "999",
        lon: "999",
        city_name: "Първо описание",
        begin_event: "04.10.2026 08:00",
        end_event: "04.10.2026 09:00",
      },
      validSecond: structuredClone(providerFixture.responses.SOF2.lower),
    };
    const expected = {
      ...expectedRaw(lowerIncident),
      title: "планирано - Първо описание - SF_0001",
      message: "планирано\n\nНаселено място: Първо описание\nНачало: 04.10.2026 08:00\nКрай: 04.10.2026 09:00\nМрежов код: SF_0001",
      markdownText: "**планирано**\n\n**Населено място:** Първо описание\n**Начало:** 04.10.2026 08:00\n**Край:** 04.10.2026 09:00\n**Мрежов код:** SF_0001",
      datePublished: "2026-10-04T08:00:00.000Z",
      timespanStart: new Date("2026-10-04T08:00:00.000Z"),
      timespanEnd: new Date("2026-10-04T09:00:00.000Z"),
    };

    await crawl();

    expect(store.records.get(lowerId)).toEqual(expected);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(expected.message, "erm-zapad", expect.objectContaining({
      precomputedGeoJson: JSON.parse(lowerIncident.content.geoJson),
      datePublished: "2026-10-04T08:00:00.000Z",
      timespanStart: new Date("2026-10-04T08:00:00.000Z"),
      timespanEnd: new Date("2026-10-04T09:00:00.000Z"),
    }));
    expectClosedRequests();
  });

  it("keeps an all-invalid-coordinate scan healthy and empty", async () => {
    responses.SOF2.lower.lat = "999";
    responses.SOF2.lower.lon = "999";

    await crawl();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: "erm-zapad", saved: 0, skipped: 0, failed: 0,
    });
    expectClosedRequests();
  });

  it("stores a swapped Sofia center in longitude-latitude order through the runner", async () => {
    responses.SOF2.lower.lat = "23.323421987654321";
    responses.SOF2.lower.lon = "42.700932123456789";

    await crawl();

    expect(store.records.get(lowerId)).toEqual(expectedRaw(lowerIncident));
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledWith(lowerIncident.content.message, "erm-zapad", expect.objectContaining({
      precomputedGeoJson: JSON.parse(lowerIncident.content.geoJson),
    }));
    expectClosedRequests();
  });

  it("preserves omitted optional dates, name and cities with absent GeoJSON properties", async () => {
    responses.SOF2 = {
      lower: {
        ceo: "SF_0001",
        lat: "42.700932123456789",
        lon: "23.323421987654321",
        typedist: "планирано",
        type_event: "1",
        grid_id: "",
        points: { cnt: "0" },
      },
    };
    const expectedGeometry = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [23.323422, 42.700932] },
        properties: { eventId: "SF_0001", eventType: "планирано" },
      }],
    };

    await crawl();

    expect(store.records.get(lowerId)).toEqual({
      ...expectedRaw(lowerIncident),
      title: "планирано - SF_0001",
      message: "планирано\n\nМрежов код: SF_0001",
      markdownText: "**планирано**\n\n**Мрежов код:** SF_0001",
      datePublished: "2026-10-04T09:15:00.000Z",
      timespanStart: contractDate,
      timespanEnd: contractDate,
      geoJson: JSON.stringify(expectedGeometry),
    });
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledWith("планирано\n\nМрежов код: SF_0001", "erm-zapad", expect.objectContaining({
      precomputedGeoJson: expectedGeometry,
      datePublished: "2026-10-04T09:15:00.000Z",
      timespanStart: contractDate,
      timespanEnd: contractDate,
    }));
    expectClosedRequests();
  });

  it("propagates database setup failure before requesting the provider", async () => {
    vi.mocked(getDb).mockRejectedValueOnce(new Error("Database unavailable"));

    await expect(crawl()).rejects.toThrow("Database unavailable");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
  });
});
