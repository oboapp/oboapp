import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MessagesGrid from "@/components/MessagesGrid";
import { recordToMessage } from "@/lib/doc-to-message";

const emptyCollection = { type: "FeatureCollection", features: [] };

function createMessage(fields: Record<string, unknown> = {}) {
  return recordToMessage({
    _id: "city-warning",
    text: "City-wide warning",
    locality: "bg.sofia",
    cityWide: true,
    createdAt: "2026-10-30T10:00:00.000Z",
    finalizedAt: "2026-10-30T10:05:00.000Z",
    ...fields,
  });
}

afterEach(() => {
  cleanup();
});

describe("MessagesGrid", () => {
  it.each([
    { name: "missing geometry", fields: {} },
    { name: "null geometry", fields: { geoJson: null } },
    { name: "an empty feature collection", fields: { geoJson: emptyCollection } },
  ])("shows finalized city-wide cards with $name", ({ fields }) => {
    const message = createMessage(fields);
    const onMessageClick = vi.fn();
    render(
      <MessagesGrid
        messages={[message]}
        isLoading={false}
        onMessageClick={onMessageClick}
        variant="list"
      />,
    );

    expect(screen.getByText("City-wide warning")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /City-wide warning/ }));
    expect(onMessageClick).toHaveBeenCalledWith(message);
  });

  it("keeps unfinalized city-wide messages out of the card list", () => {
    render(
      <MessagesGrid
        messages={[createMessage({ finalizedAt: undefined })]}
        isLoading={false}
        onMessageClick={vi.fn()}
        variant="list"
      />,
    );

    expect(screen.queryByText("City-wide warning")).not.toBeInTheDocument();
    expect(screen.getByText("Няма налични съобщения")).toBeVisible();
  });

  it("keeps ordinary messages without geometry out of the card list", () => {
    render(
      <MessagesGrid
        messages={[createMessage({ cityWide: false })]}
        isLoading={false}
        onMessageClick={vi.fn()}
        variant="list"
      />,
    );

    expect(screen.queryByText("City-wide warning")).not.toBeInTheDocument();
    expect(screen.getByText("Няма налични съобщения")).toBeVisible();
  });
});
