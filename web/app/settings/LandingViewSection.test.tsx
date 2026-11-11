import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingViewSection } from "./LandingViewSection";

const STORAGE_KEY = "landingViewPreference:v2";

describe("LandingViewSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the default All choice without storing a preference", () => {
    render(<LandingViewSection />);

    expect(screen.getByRole("radio", { name: "Всички" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Около мен" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Моите зони" })).not.toBeChecked();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/на това устройство/)).toBeInTheDocument();
  });

  it("saves every home choice and allows automatic location to be turned off", () => {
    render(<LandingViewSection />);

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe("zones");
    expect(screen.getByRole("radio", { name: "Моите зони" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Около мен" }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe("nearby");
    expect(screen.getByRole("radio", { name: "Около мен" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Всички" }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe("all");
    expect(screen.getByRole("radio", { name: "Всички" })).toBeChecked();
  });

  it("restores the saved choice when settings reopen", () => {
    localStorage.setItem(STORAGE_KEY, "zones");

    render(<LandingViewSection />);

    expect(screen.getByRole("radio", { name: "Моите зони" })).toBeChecked();
  });

  it("shows the migrated location home and explains the three startup behaviors", () => {
    localStorage.setItem("geolocationPermissionGranted", "true");

    render(<LandingViewSection />);

    expect(screen.getByRole("radio", { name: "Около мен" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Всички" })).toHaveAccessibleDescription(
      "Общ изглед на града при отваряне.",
    );
    expect(screen.getByRole("radio", { name: "Около мен" })).toHaveAccessibleDescription(
      "Използва текущото местоположение при отваряне.",
    );
    expect(screen.getByRole("radio", { name: "Моите зони" })).toHaveAccessibleDescription(
      "Показва събитията, които засягат запазените ти зони.",
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("shows a storage error and keeps the saved choice after a failed change", () => {
    localStorage.setItem(STORAGE_KEY, "all");
    const storedValues = localStorage;
    vi.stubGlobal("localStorage", {
      getItem: storedValues.getItem.bind(storedValues),
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    render(<LandingViewSection />);

    fireEvent.click(screen.getByRole("radio", { name: "Моите зони" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Настройката не се запази");
    expect(screen.getByRole("radio", { name: "Всички" })).toBeChecked();
  });
});
