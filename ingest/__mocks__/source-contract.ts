import { vi } from "vitest";
import type { OboDb } from "@oboapp/db";
import type { Browser, Page } from "playwright";

/** Small stateful fake; unsupported query operators fail explicitly. */
export function createSourceStore() {
  const records = new Map<string, Record<string, unknown>>();
  const sources = {
    findById: vi.fn<OboDb["sources"]["findById"]>(async (id) => records.get(id) ?? null),
    setOne: vi.fn<OboDb["sources"]["setOne"]>(async (id, data) => { records.set(id, { ...data }); }),
    updateOne: vi.fn<OboDb["sources"]["updateOne"]>(async (id, data) => {
      if (!records.has(id)) throw new Error(`Missing source: ${id}`);
      records.set(id, { ...records.get(id), ...data });
    }),
    findMany: vi.fn<OboDb["sources"]["findMany"]>(async (options) => {
      let result = [...records.values()].filter((record) =>
        (options?.where ?? []).every(({ field, op, value }) => {
          if (op !== "==") throw new Error(`Unsupported operator: ${op}`);
          return record[field] === value;
        }),
      );
      if (options?.limit) result = result.slice(0, options.limit);
      return result.map((record) => ({ ...record }));
    }),
  };
  return { records, sources, db: { sources } as unknown as OboDb };
}

export function createBrowserMock() {
  const page = {
    goto: vi.fn().mockResolvedValue(null), content: vi.fn().mockResolvedValue("<html></html>"),
    evaluate: vi.fn(), route: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
  return { page, browser, instance: browser as unknown as Browser, pageInstance: page as unknown as Page };
}

export const contractDate = new Date("2026-10-04T09:15:00.000Z");

export function rawSource(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://example.com/item", title: "Repair", message: "Water repair",
    sourceType: "sofiyska-voda", locality: "bg.sofia",
    datePublished: contractDate.toISOString(), crawledAt: contractDate, ...overrides,
  };
}
