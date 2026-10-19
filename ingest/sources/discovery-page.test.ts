import { describe, expect, it } from "vitest";
import type { DiscoveryPage } from "@oboapp/source-sdk";
import { prepareDiscoveryPage } from "./discovery-page";

describe("discovery page boundaries", () => {
  it.each([
    { name: "null page", page: null },
    { name: "missing items", page: {} },
    { name: "sparse items", page: { items: new Array(1) } },
    { name: "null item", page: { items: [null] } },
    { name: "empty identifier", page: { items: [{ identifier: "" }] } },
    { name: "blank identifier", page: { items: [{ identifier: "   " }] } },
    { name: "large identifier", page: { items: [{ identifier: "x".repeat(8193) }] } },
    { name: "non-string revision", page: { items: [{ identifier: "id", observedAt: 1 }] } },
    { name: "null cursor", page: { items: [], nextCursor: null } },
    { name: "large UTF-8 cursor", page: { items: [], nextCursor: "я".repeat(4096) } },
    { name: "too many items", page: { items: Array.from({ length: 501 }, () => ({ identifier: "id" })) } },
  ])("rejects $name", ({ page }) => {
    expect(() => prepareDiscoveryPage("example", "bg.sofia", page as DiscoveryPage)).toThrow();
  });

  it("enforces aggregate page size even when every individual payload fits", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ identifier: `id-${index}`, payload: "x".repeat(250 * 1024) }));
    expect(() => prepareDiscoveryPage("example", "bg.sofia", { items })).toThrow("page exceeds 1 MiB");
  });

  it("preserves exact identifiers and never copies provider-owned platform fields", () => {
    const identifier = "https://example.com/A%2fb?x=1&y=2";
    const untrustedPage = {
      items: [{ identifier, sourceType: "spoofed", processed: false, payload: null }],
    };
    const prepared = prepareDiscoveryPage("example", "bg.sofia", untrustedPage);
    expect(prepared.items).toEqual([{ identifier, sourceType: "example", locality: "bg.sofia", payloadJson: "null" }]);
  });
});
