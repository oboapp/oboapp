import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Locations from "./Locations";
import type { Address } from "@/lib/types";

const createAddress = (overrides: Partial<Address> = {}): Address => ({
  originalText: "Спирка 1805",
  formattedAddress: "Ул. 507 (1805)",
  coordinates: { lat: 42.6977, lng: 23.3219 },
  ...overrides,
});

describe("Locations – bus stops", () => {
  it("displays formattedAddress when a matching address is found", () => {
    render(
      <Locations
        busStops={["Спирка 1805"]}
        addresses={[createAddress()]}
      />,
    );

    expect(screen.getByText("Ул. 507 (1805)")).toBeInTheDocument();
    expect(screen.queryByText("Спирка 1805")).not.toBeInTheDocument();
  });

  it("falls back to raw busStop string when no matching address exists", () => {
    render(
      <Locations
        busStops={["Спирка 9999"]}
        addresses={[createAddress()]}
      />,
    );

    expect(screen.getByText("Спирка 9999")).toBeInTheDocument();
  });

  it("falls back to raw busStop string when addresses is null", () => {
    render(<Locations busStops={["1805"]} addresses={null} />);

    expect(screen.getByText("1805")).toBeInTheDocument();
  });

  it("matches bus stop text case-insensitively", () => {
    render(
      <Locations
        busStops={["спирка 1805"]}
        addresses={[createAddress({ originalText: "Спирка 1805" })]}
      />,
    );

    expect(screen.getByText("Ул. 507 (1805)")).toBeInTheDocument();
  });

  it("renders clickable card when address has coordinates", async () => {
    const onLocationClick = vi.fn();
    render(
      <Locations
        busStops={["Спирка 1805"]}
        addresses={[createAddress()]}
        onLocationClick={onLocationClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Ул. 507 (1805)" });
    await userEvent.click(button);
    expect(onLocationClick).toHaveBeenCalledWith(42.6977, 23.3219);
  });

  it("resolves raw stop code via Спирка prefix fallback", () => {
    render(
      <Locations
        busStops={["0529"]}
        addresses={[
          createAddress({
            originalText: "Спирка 0529",
            formattedAddress: "Ул. Хаджи Димитър (0529)",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Ул. Хаджи Димитър (0529)")).toBeInTheDocument();
    expect(screen.queryByText("0529")).not.toBeInTheDocument();
  });

  it("clicking a raw stop code navigates to correct coordinates", async () => {
    const onLocationClick = vi.fn();
    render(
      <Locations
        busStops={["0529"]}
        addresses={[
          createAddress({
            originalText: "Спирка 0529",
            formattedAddress: "Ул. Хаджи Димитър (0529)",
            coordinates: { lat: 42.7, lng: 23.35 },
          }),
        ]}
        onLocationClick={onLocationClick}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Ул. Хаджи Димитър (0529)",
    });
    await userEvent.click(button);
    expect(onLocationClick).toHaveBeenCalledWith(42.7, 23.35);
  });

  it("displays multiple bus stops with resolved names", () => {
    const addresses = [
      createAddress({
        originalText: "Спирка 1805",
        formattedAddress: "Ул. 507 (1805)",
      }),
      createAddress({
        originalText: "Спирка 2001",
        formattedAddress: "Хладилника (2001)",
      }),
    ];

    render(
      <Locations
        busStops={["Спирка 1805", "Спирка 2001"]}
        addresses={addresses}
      />,
    );

    expect(screen.getByText("Ул. 507 (1805)")).toBeInTheDocument();
    expect(screen.getByText("Хладилника (2001)")).toBeInTheDocument();
  });
});
