import { beforeEach, describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { loadInterestReport } from "@/lib/interest-coverage-store";
import type { InterestCoverageReport } from "@oboapp/shared";

vi.mock("@/lib/interest-coverage-store", () => ({ loadInterestReport: vi.fn() }));
vi.mock("@/lib/report-pages", () => ({ hasReportPagesEnabled: () => true }));
describe("public static interest report", () => {
  beforeEach(() => vi.clearAllMocks());
  it("serves the stored JSON without auth using the standard public report cache", async () => {
    const report: InterestCoverageReport = { version: 1, locality: "bg.sofia", generatedAt: "2026-10-02T10:00:00.000Z", gridMeters: 2000, status: "unavailable", summary: null, cells: [] };
    vi.mocked(loadInterestReport).mockResolvedValue(report);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
  });
  it("does not cache missing report responses", async () => {
    vi.mocked(loadInterestReport).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
