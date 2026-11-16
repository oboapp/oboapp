// @vitest-environment node

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "@oboapp/source-sdk";
import { createSource, type ToploListingObserver } from "@oboapp/source-toplo-bg";
import { contractDate } from "@/__mocks__/source-contract";
import { toploHtml } from "@/__mocks__/source-contract-fixtures";

const require = createRequire(import.meta.url);
const commonJs: { createSource: typeof createSource } = require("@oboapp/source-toplo-bg");
const instances: DataSource[] = [];
let fetchListing: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  fetchListing = vi.fn<typeof globalThis.fetch>(async () => {
    return new Response(toploHtml());
  });
  vi.stubGlobal("fetch", fetchListing);
});

afterEach(async () => {
  for (const instance of instances.splice(0)) {
    await instance.close?.();
  }

  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sourceWithObserver(onListing: ToploListingObserver): DataSource {
  const source = createSource({ locality: "bg.sofia" }, { onListing });
  instances.push(source);
  return source;
}

describe("Toplo package listing observer", () => {
  it.each([
    { format: "ESM", factory: createSource },
    { format: "CommonJS", factory: commonJs.createSource },
  ])("exposes the same single-request observer in $format", async ({ factory }) => {
    const onListing = vi.fn<ToploListingObserver>().mockResolvedValue({ count: 1 });
    const source = factory({ locality: "bg.sofia" }, { onListing });
    instances.push(source);

    const discovery = await source.discoverItems();
    await source.fetchItem(discovery.items[0]);

    expect(onListing).toHaveBeenCalledExactlyOnceWith({
      html: toploHtml(),
      observedAt: contractDate.toISOString(),
    });
    expect(fetchListing).toHaveBeenCalledOnce();
  });

  it("preserves the package's default empty-list rejection without an observer", async () => {
    fetchListing.mockResolvedValue(new Response(toploHtml([])));
    const source = createSource({ locality: "bg.sofia" });
    instances.push(source);

    await expect(source.discoverItems()).rejects.toThrow("No incidents found in HTML");
  });

  it("permits an empty discovery only after its observer verifies zero", async () => {
    fetchListing.mockResolvedValue(new Response(toploHtml([])));
    const source = sourceWithObserver(async () => {
      return { count: 0 };
    });

    await expect(source.discoverItems()).resolves.toEqual({ items: [] });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid observer count: %s",
    async (count) => {
      const source = sourceWithObserver(async () => {
        return { count };
      });

      await expect(source.discoverItems()).rejects.toThrow("nonnegative safe integer count");
    },
  );

  it("propagates an observer failure", async () => {
    const source = sourceWithObserver(async () => {
      throw new Error("Incomplete listing");
    });

    await expect(source.discoverItems()).rejects.toThrow("Incomplete listing");
  });

  it("does not observe HTTP failures", async () => {
    fetchListing.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    const onListing = vi.fn<ToploListingObserver>().mockResolvedValue({ count: 0 });
    const source = sourceWithObserver(onListing);

    await expect(source.discoverItems()).rejects.toThrow("HTTP 503");
    expect(onListing).not.toHaveBeenCalled();
  });
});
