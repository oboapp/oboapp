import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventsPage from "./events/page";
import IngestErrorsPage from "./ingest-errors/page";
import UnreadablePage from "./unreadable/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/MessageDetailView/MessageDetailView", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cursor = { id: "cursor", finalizedAt: "2026-10-04T11:00:00Z", updatedAt: "2026-10-04T11:00:00Z" };
const sampleText = "Съобщение от първата страница";
const message = { id: "msg12345", text: sampleText, createdAt: cursor.finalizedAt, locality: "bg.sofia" };
const event = { id: "event123", plainText: sampleText, sources: [], messageCount: 1 };
const messageLists = {
  page: { messages: [message], nextCursor: cursor },
  empty: "Няма налични съобщения",
  loading: "Съобщенията се зареждат.",
  finished: "Съобщенията са заредени.",
  error: "Грешка при зареждане на съобщенията. Опитай отново.",
};

describe.each([
  { name: "unreadable messages", Page: UnreadablePage, ...messageLists },
  { name: "ingest errors", Page: IngestErrorsPage, ...messageLists },
  {
    name: "events",
    Page: EventsPage,
    page: { events: [event], nextCursor: cursor },
    empty: "Няма налични групирани съобщения.",
    loading: "Събитията се зареждат.",
    finished: "Събитията са заредени.",
    error: "Грешка при зареждане на събитията. Опитай отново.",
  },
])("$name", ({ Page, page, empty, loading, finished, error }) => {
  function openList() {
    const requests: Array<(response: Response) => void> = [];
    const fetchPage = () => new Promise<Response>((resolve) => {
      requests.push(resolve);
    });
    vi.stubGlobal("fetch", fetchPage);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
    return requests;
  }

  it("announces the first page and a failed next page while keeping the previous results", async () => {
    const requests = openList();
    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(loading));
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    await act(() => requests[0](Response.json(page)));
    await waitFor(() => expect(status).toHaveTextContent(finished));
    expect(screen.getByText(sampleText)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Покажи още" }));
    await waitFor(() => expect(status).toHaveTextContent(loading));
    expect(screen.getByRole("button", { name: "Зареждане..." })).toBeDisabled();
    await act(() => requests[1](new Response(null, { status: 503 })));
    await waitFor(() => expect(status).toHaveTextContent(error));
    expect(screen.getByText(sampleText)).toBeVisible();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it("announces an initial error without showing the empty result", async () => {
    const requests = openList();
    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(loading));
    await act(() => requests[0](new Response(null, { status: 503 })));
    await waitFor(() => expect(status).toHaveTextContent(error));
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });
});
