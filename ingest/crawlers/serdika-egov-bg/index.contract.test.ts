// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-serdika-egov-bg/metadata";
import { createSourceStore } from "@/__mocks__/source-contract";
import { encodeDocumentId, encodeDocumentIdForLookup } from "@/crawlers/shared/firestore";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";
import definition from "../../../shared/src/sources/serdika-egov-bg";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));

const relative = "?urile=wcm%3Apath%3A%2Fcontent%2Fsite%2Factual%2Fmessages%2Frepair";
const identifier = "https://serdika.egov.bg/wps/portal/serdika.egov.bg-15783" + relative;
const entry = `<atom:entry><atom:link href="${relative}" type="text/html"/>
  <wplc:field id="contentpath">/content/site/actual/messages/repair</wplc:field></atom:entry>`;
const feed = `<atom:feed>${entry}</atom:feed>`;
const article = `<h2>Ремонт</h2><div id="publish-date">Дата на публикуване: 04.10.2026</div>
  <div id="body"><p>Ремонт на пътя.</p></div>`;
let store: ReturnType<typeof createSourceStore>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LOCALITY", "bg.sofia");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T09:15:00Z"));
  store = createSourceStore();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Serdika packaged source", () => {
  it("saves one notice across overlapping sections, hands it to ingestion and skips it on the next scan", async () => {
    expect(metadata).toEqual(definition);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(url === identifier ? article : feed);
    });
    await crawl();
    const id = encodeDocumentId(identifier);
    expect(store.records.get(id)).toEqual({
      url: identifier, sourceType: metadata.id, locality: "bg.sofia", title: "Ремонт",
      datePublished: "2026-10-04T00:00:00.000Z", message: "Ремонт на пътя.",
      processed: false, crawledAt: expect.any(Date),
    });
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith("Ремонт на пътя.", metadata.id,
      expect.objectContaining({ sourceDocumentId: id, sourceUrl: identifier }));
    await crawl();
    expect(urls.filter((url) => url === identifier)).toHaveLength(1);
    expect(store.client.createOne).toHaveBeenCalledOnce();
  });

  it.each(encodeDocumentIdForLookup(identifier))("preserves the historical record keyed by %s", async (id) => {
    const old = { url: identifier, sourceType: metadata.id, processed: true };
    store.records.set(id, old);
    const request = vi.fn(async () => new Response(feed));
    vi.stubGlobal("fetch", request);
    await crawl();
    expect(store.records.get(id)).toBe(old);
    expect(request).toHaveBeenCalledTimes(3);
    expect(store.client.createOne).not.toHaveBeenCalled();
  });

  it("reports failed sections and retries an incomplete notice on a later scan", async () => {
    let details = "<p>Maintenance</p>";
    const warning = vi.spyOn(logger, "warn");
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === identifier) {
        return new Response(details);
      }
      const keyword = new URL(url).searchParams.getAll("constraint")[1];
      if (keyword?.includes("actualmessages")) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(keyword?.includes("actualnews") ? feed : "<atom:feed/>");
    });
    await crawl();
    expect(store.records.size).toBe(0);
    expect(warning).toHaveBeenCalledWith("Failed to fetch Serdika section",
      expect.objectContaining({ section: "actualmessages" }));
    details = article;
    await crawl();
    expect(store.records.size).toBe(1);
  }, 15_000);
});
