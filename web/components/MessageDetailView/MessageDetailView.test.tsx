import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Message } from "@/lib/types";
import MessageDetailView from "./MessageDetailView";

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/message-classification", () => ({
  classifyMessage: () => "active",
}));

vi.mock("@/lib/hooks/useDragPanel", () => ({
  useDragPanel: () => ({
    isDragging: false,
    dragOffset: 0,
    handlers: {
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
      onMouseDown: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/hooks/useMessageAnimation", () => ({
  useMessageAnimation: () => true,
}));

vi.mock("@/lib/hooks/useEscapeKey", () => ({
  useEscapeKey: vi.fn(),
}));

vi.mock("@/lib/geometry-utils", () => ({
  getFeaturesCentroid: () => null,
}));

vi.mock("@/components/CategoryChips", () => ({
  default: () => <div data-testid="category-chips" />,
}));

vi.mock("./Header", () => ({
  default: () => <div data-testid="message-detail-header" />,
}));

vi.mock("./Source", () => ({
  default: () => <div data-testid="message-detail-source" />,
}));

vi.mock("./Locations", () => ({
  hasAnyLocations: (groups: {
    pins?: unknown[] | null;
    streets?: unknown[] | null;
    busStops?: unknown[] | null;
    cadastralProperties?: unknown[] | null;
  }) =>
    (groups.pins?.length ?? 0) +
      (groups.streets?.length ?? 0) +
      (groups.busStops?.length ?? 0) +
      (groups.cadastralProperties?.length ?? 0) >
    0,
  getLocationItemCount: (groups: {
    pins?: unknown[] | null;
    streets?: unknown[] | null;
    busStops?: unknown[] | null;
    cadastralProperties?: unknown[] | null;
  }) =>
    (groups.pins?.length ?? 0) +
    (groups.streets?.length ?? 0) +
    (groups.busStops?.length ?? 0) +
    (groups.cadastralProperties?.length ?? 0),
  default: () => <div data-testid="message-detail-locations" />,
}));

const baseMessage: Message = {
  id: "m1",
  text: "Тестово съобщение",
  plainText: "Тестово съобщение",
  createdAt: "2026-04-07T00:00:00.000Z",
  locality: "София",
  source: "sofiatraffic",
  responsibleEntity: "Столична община",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "(max-width: 639px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MessageDetailView AI notice", () => {
  it("shows source-aware notice when sourceUrl is valid https", () => {
    render(
      <MessageDetailView
        message={{ ...baseMessage, sourceUrl: "https://example.com/msg" }}
        onClose={vi.fn()}
      />,
    );

    const sourceLink = screen.getByRole("link", {
      name: /оригиналния източник/i,
    });
    expect(sourceLink).toHaveAttribute("href", "https://example.com/msg");
    expect(
      within(sourceLink).getByTestId("external-link-icon"),
    ).toBeInTheDocument();
  });

  it("shows source-neutral notice when sourceUrl is missing", () => {
    render(<MessageDetailView message={baseMessage} onClose={vi.fn()} />);

    expect(
      screen.getByText(
        "Съдържанието е обработено от AI и може да съдържа неточности.",
      ),
    ).toBeInTheDocument();

    expect(
      screen.queryByText(/За пълен контекст виж оригиналния източник\./),
    ).not.toBeInTheDocument();
  });

  it("shows source-neutral notice when sourceUrl is not https", () => {
    render(
      <MessageDetailView
        message={{ ...baseMessage, sourceUrl: "http://example.com/msg" }}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Съдържанието е обработено от AI и може да съдържа неточности.",
      ),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("link", { name: /оригиналния източник/i }),
    ).not.toBeInTheDocument();
  });

  it("renders notice below responsible entity", () => {
    render(
      <MessageDetailView
        message={{ ...baseMessage, sourceUrl: "https://example.com/msg" }}
        onClose={vi.fn()}
      />,
    );

    const responsibleEntity = screen.getByText("Столична община");
    const notice = screen.getByText(
      /Съдържанието е обработено от AI и може да съдържа неточности\./,
    );

    expect(
      responsibleEntity.compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders notice for message with markdownText", () => {
    render(
      <MessageDetailView
        message={{
          ...baseMessage,
          markdownText: "**Тестово** съобщение",
          sourceUrl: "https://example.com/msg",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /Съдържанието е обработено от AI и може да съдържа неточности\./,
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /оригиналния източник/i }),
    ).toBeInTheDocument();
  });
});

describe("MessageDetailView summary notice", () => {
  it("shows inline summary notice (not blue box) when summary is present", () => {
    render(
      <MessageDetailView
        message={{
          ...baseMessage,
          summary: "Кратко резюме.",
          sourceUrl: "https://example.com/msg",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Съдържанието е съкратено от AI\./),
    ).toBeInTheDocument();

    // Blue box must not appear
    expect(
      screen.queryByText(
        /Съдържанието е обработено от AI и може да съдържа неточности\./,
      ),
    ).not.toBeInTheDocument();
  });

  it("inline summary notice links to sourceUrl when valid", () => {
    render(
      <MessageDetailView
        message={{
          ...baseMessage,
          summary: "Кратко резюме.",
          sourceUrl: "https://example.com/msg",
        }}
        onClose={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: /оригиналния източник/i });
    expect(link).toHaveAttribute("href", "https://example.com/msg");
  });

  it("inline summary notice has no link when sourceUrl is missing", () => {
    render(
      <MessageDetailView
        message={{ ...baseMessage, summary: "Кратко резюме." }}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Съдържанието е съкратено от AI\./),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("link", { name: /оригиналния източник/i }),
    ).not.toBeInTheDocument();
  });

  it("inline summary notice appears before responsible entity", () => {
    render(
      <MessageDetailView
        message={{
          ...baseMessage,
          summary: "Кратко резюме.",
          sourceUrl: "https://example.com/msg",
        }}
        onClose={vi.fn()}
      />,
    );

    const notice = screen.getByText(/Съдържанието е съкратено от AI\./);
    const responsibleEntity = screen.getByText("Столична община");

    expect(
      notice.compareDocumentPosition(responsibleEntity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("MessageDetailView locations accordion", () => {
  it("keeps location sections collapsed by default", () => {
    render(
      <MessageDetailView
        message={{
          ...baseMessage,
          pins: [{ address: "ул. Шипка", timespans: [] }],
          geoJson: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [23.32, 42.69] },
                properties: {},
              },
            ],
          },
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Покажи локация (1)" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("message-detail-locations")).not.toBeVisible();
  });

  it("toggles location sections when locations accordion is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MessageDetailView
        message={{
          ...baseMessage,
          pins: [{ address: "ул. Шипка", timespans: [] }],
          geoJson: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [23.32, 42.69] },
                properties: {},
              },
            ],
          },
        }}
        onClose={vi.fn()}
      />,
    );

    const toggleButton = screen.getByRole("button", {
      name: "Покажи локация (1)",
    });
    await user.click(toggleButton);

    expect(screen.getByTestId("message-detail-locations")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Скрий локация (1)" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Скрий локация (1)" }));
    expect(screen.getByTestId("message-detail-locations")).not.toBeVisible();
  });

  it("does not render locations accordion when there are no locations", () => {
    render(
      <MessageDetailView
        message={{
          ...baseMessage,
          geoJson: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [23.32, 42.69] },
                properties: {},
              },
            ],
          },
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText(/локации/i)).not.toBeInTheDocument();
  });
});
