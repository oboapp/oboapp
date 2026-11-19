// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-krasna-polyana-org/metadata";
import { createSourceStore } from "@/__mocks__/source-contract";
import { encodeDocumentId, encodeDocumentIdForLookup } from "@/crawlers/shared/firestore";
import { getDb } from "@/lib/db";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";
import sourceDefinition from "../../../shared/src/sources/krasna-polyana-org";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));

const row = {
  link: "https://krasnapolyana.bg/notifications/%d0%95%d1%81/",
  date_gmt: "2026-11-10T07:16:18",
  title: { rendered: "Ремонт" },
  content: { rendered: "<p>Затваряне за <strong>ремонт</strong>.</p>" },
};
const oldUrl = "https://krasnapolyana.bg/home/latest-news/343-2026-05-28-14-41-39";
let store: ReturnType<typeof createSourceStore>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Krasna Polyana WordPress handoff", () => {
  it("ingests new notices once while preserving Joomla documents", async () => {
    expect(metadata).toEqual(sourceDefinition);
    const oldRecord = { url: oldUrl, processed: true, title: "Покана" };
    store.records.set(encodeDocumentId(oldUrl), oldRecord);
    vi.stubGlobal("fetch", async () => Response.json([row]));
    await crawl();
    const id = encodeDocumentId(row.link);
    expect(store.records.get(id)).toEqual({
      url: row.link, sourceType: metadata.id, locality: "bg.sofia", title: "Ремонт",
      message: "Затваряне за **ремонт**.", datePublished: "2026-11-10T07:16:18.000Z",
      processed: false, crawledAt: expect.any(Date),
    });
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(
      "Затваряне за **ремонт**.", metadata.id, expect.objectContaining({ sourceDocumentId: id }),
    );
    await crawl();
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.records.get(encodeDocumentId(oldUrl))).toBe(oldRecord);
  });

  it.each(encodeDocumentIdForLookup(row.link))("skips existing ID %s", async (id) => {
    const existing = { url: row.link, processed: false, title: "Исторически запис" };
    store.records.set(id, existing);
    vi.stubGlobal("fetch", async () => Response.json([{ ...row, content: null }]));
    await crawl();
    expect(store.records.get(id)).toBe(existing);
    expect(store.client.createOne).not.toHaveBeenCalled();
  });

  it("retries incomplete notices while skipping the successful part of a scan", async () => {
    const other = { ...row, link: "https://krasnapolyana.bg/notifications/other/" };
    vi.stubGlobal("fetch", async () => Response.json([{ ...row, content: null }, other]));
    await crawl();
    expect([...store.records.keys()]).toEqual([encodeDocumentId(other.link)]);
    vi.stubGlobal("fetch", async () => Response.json([row, other]));
    await crawl();
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
    expect(store.records.has(encodeDocumentId(row.link))).toBe(true);
  });
});
