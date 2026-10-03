import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { makeInterestCoverageGrid } from "@oboapp/shared";
import InterestCoverageContent from "./InterestCoverageContent";
import { formatDateTime } from "@/lib/date-format";

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="coverage-map">Map</div> }));

const publicReport = {
  version: 1, locality: "bg.sofia", generatedAt: "2026-10-02T10:00:00.000Z", gridMeters: 2000,
  status: "available", summary: { users: { min: 10, max: 19 }, interests: { min: 20, max: 29 } },
  cells: [{ ...makeInterestCoverageGrid("bg.sofia").cells[0], users: { min: 10, max: 19 } }],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("interest coverage page privacy states", () => {
  it("displays count bands and the report timestamp with a safe map", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(publicReport))));
    render(<InterestCoverageContent />);
    expect(screen.getByText("Зареждане на отчета…")).toBeInTheDocument();
    expect(await screen.findByTestId("coverage-map")).toBeInTheDocument();
    expect(screen.getByText("10–19")).toBeInTheDocument();
    expect(screen.getByText("20–29")).toBeInTheDocument();
    expect(document.querySelector("time")?.dateTime).toBe(publicReport.generatedAt);
    expect(screen.getByText(formatDateTime(publicReport.generatedAt))).toBeInTheDocument();
    expect(screen.getByText(/Генериран:/)).toBeInTheDocument();
  });
  it("shows a loading error without map or summary counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    render(<InterestCoverageContent />);
    expect(await screen.findByText(/Отчетът не може да се зареди/)).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-map")).not.toBeInTheDocument();
    expect(screen.queryByText("Запазени зони")).not.toBeInTheDocument();
  });
  it("shows an unavailable state without counts or map", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...publicReport, status: "unavailable", cells: [], summary: null }))));
    render(<InterestCoverageContent />);
    expect(await screen.findByText(/Картата не е достъпна за този отчет/)).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-map")).not.toBeInTheDocument();
    expect(screen.queryByText("Запазени зони")).not.toBeInTheDocument();
  });
});
