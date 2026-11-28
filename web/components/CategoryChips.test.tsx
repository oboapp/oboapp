import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import CategoryChips from "@/components/CategoryChips";

let resizeCallback: ResizeObserverCallback | null = null;
let originalResizeObserver: typeof ResizeObserver | undefined;

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeCallback = callback;
  }

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

beforeEach(() => {
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
  resizeCallback = null;
  vi.unstubAllGlobals();
});

describe("CategoryChips", () => {
  it("returns null when categories are missing", () => {
    const { container } = render(<CategoryChips categories={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders localized category labels", () => {
    render(<CategoryChips categories={["water"]} />);
    expect(screen.getByText("Вода")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вода" })).toBeInTheDocument();
  });

  it("centers a selected chip immediately when reduced motion is enabled", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    render(<CategoryChips categories={["water"]} />);
    const chip = screen.getByRole("button", { name: "Вода" });
    const scrollIntoView = vi.fn();
    chip.scrollIntoView = scrollIntoView;

    fireEvent.click(chip);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "nearest",
      inline: "center",
    });
  });

  it("shows fades when chips overflow", async () => {
    const { container } = render(
      <CategoryChips categories={["water", "traffic", "waste"]} />,
    );

    const scrollContainer = container.querySelector(
      "[data-category-scroll]",
    ) as HTMLElement | null;
    expect(scrollContainer).not.toBeNull();

    if (!scrollContainer) {
      return;
    }

    Object.defineProperty(scrollContainer, "scrollWidth", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientWidth", {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "scrollLeft", {
      value: 0,
      writable: true,
      configurable: true,
    });

    await act(async () => {
      resizeCallback?.(
        [{ target: scrollContainer } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    expect(
      container.querySelector('[data-category-fade="left"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-category-fade="right"]'),
    ).toBeInTheDocument();

    await act(async () => {
      scrollContainer.scrollLeft = 50;
      scrollContainer.dispatchEvent(new Event("scroll"));
    });

    expect(
      container.querySelector('[data-category-fade="left"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-category-fade="right"]'),
    ).toBeInTheDocument();

    await act(async () => {
      scrollContainer.scrollLeft = 200;
      scrollContainer.dispatchEvent(new Event("scroll"));
    });

    expect(
      container.querySelector('[data-category-fade="left"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-category-fade="right"]'),
    ).not.toBeInTheDocument();
  });
});
