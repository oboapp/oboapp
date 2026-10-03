import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationsReportClient from "./NotificationsReportClient";

vi.mock("@/lib/source-utils", () => ({
  getCurrentLocalitySources: () => [{ id: "test", name: "Тестов източник" }],
}));
const totals = {
  processed: 0,
  sent: 0,
  failed: 0,
  noSubscriptions: 0,
  unknownDelivery: 0,
  clicked: 0,
  opened: 0,
};
const snapshot = {
  version: 1,
  generatedAt: "2026-10-02T12:00:00.000Z",
  periodStart: null,
  periodEnd: null,
  firstRecordedClickAt: null,
  kpis: { ...totals, uniqueUsers: 0 },
  sources: [],
};

function renderReport() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsReportClient />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("notifications report", () => {
  it("shows loading without prematurely presenting zero counts", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderReport();
    expect(screen.getByRole("status")).toHaveTextContent("Зареждане");
    expect(
      screen.queryByText("Все още няма обработени известия."),
    ).not.toBeInTheDocument();
  });
  it("shows an empty report", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(snapshot)));
    renderReport();
    expect(
      await screen.findByText("Все още няма обработени известия."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a readable error without exposing schema diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ invalid: true })),
    );
    renderReport();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Данните в отчета не успяха да се заредят",
    );
    expect(screen.queryByText(/Invalid input/)).not.toBeInTheDocument();
  });
  it("shows an unavailable state and allows retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(snapshot));
    vi.stubGlobal("fetch", fetch);
    renderReport();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "все още не е наличен",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Опитай отново" }),
    );
    expect(
      await screen.findByText("Все още няма обработени известия."),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("displays source names and distinct engagement metrics without a made-up tracking start", async () => {
    const source = {
      source: "test",
      ...totals,
      processed: 1,
      sent: 1,
      clicked: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            ...snapshot,
            kpis: { ...source, uniqueUsers: 1 },
            sources: [source],
          }),
        ),
    );
    renderReport();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Тестов източник")).toBeInTheDocument();
    expect(screen.getByText("Кликове от push известия")).toBeInTheDocument();
    expect(screen.getByText("Отворени от историята")).toBeInTheDocument();
    expect(
      screen.queryByText(/Първи записан push клик/),
    ).not.toBeInTheDocument();
  });
});
