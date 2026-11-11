import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import SegmentedControl from "@/components/SegmentedControl";

const OPTIONS = [
  { value: "zones", label: "Моите зони" },
  { value: "events", label: "Събития" },
] as const;

describe("SegmentedControl", () => {
  it("renders all options", () => {
    render(
      <SegmentedControl options={OPTIONS} value="zones" onChange={vi.fn()} />,
    );
    expect(screen.getByText("Моите зони")).toBeInTheDocument();
    expect(screen.getByText("Събития")).toBeInTheDocument();
  });

  it("marks the active option with aria-checked=true", () => {
    render(
      <SegmentedControl options={OPTIONS} value="zones" onChange={vi.fn()} />,
    );
    const zonesBtn = screen.getByRole("radio", { name: "Моите зони" });
    const eventsBtn = screen.getByRole("radio", { name: "Събития" });
    expect(zonesBtn).toHaveAttribute("aria-checked", "true");
    expect(eventsBtn).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the clicked option value", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={OPTIONS} value="zones" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Събития" }));
    expect(onChange).toHaveBeenCalledWith("events");
  });

  it("allows reselecting the active view to refresh its location", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={OPTIONS} value="zones" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expect(onChange).toHaveBeenCalledWith("zones");
  });

  it("does not call onChange when clicking a disabled option", async () => {
    const onChange = vi.fn();
    const optionsWithDisabled = [
      { value: "zones", label: "Моите зони", disabled: true },
      { value: "events", label: "Събития" },
    ] as const;
    render(
      <SegmentedControl
        options={optionsWithDisabled}
        value="events"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Моите зони" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks disabled options with aria-disabled", () => {
    const optionsWithDisabled = [
      { value: "zones", label: "Моите зони", disabled: true },
      { value: "events", label: "Събития" },
    ] as const;
    render(
      <SegmentedControl
        options={optionsWithDisabled}
        value="events"
        onChange={vi.fn()}
      />,
    );
    const zonesBtn = screen.getByRole("radio", { name: "Моите зони" });
    const eventsBtn = screen.getByRole("radio", { name: "Събития" });
    expect(zonesBtn).toHaveAttribute("aria-disabled", "true");
    expect(eventsBtn).not.toHaveAttribute("aria-disabled");
  });

  it("does not call onChange when a disabled option is activated via keyboard", async () => {
    const onChange = vi.fn();
    const optionsWithDisabled = [
      { value: "zones", label: "Моите зони", disabled: true },
      { value: "events", label: "Събития" },
    ] as const;
    render(
      <SegmentedControl
        options={optionsWithDisabled}
        value="events"
        onChange={onChange}
      />,
    );
    const zonesBtn = screen.getByRole("radio", { name: "Моите зони" });
    // Disabled option should not be focusable via tab
    expect(zonesBtn).toHaveAttribute("tabindex", "-1");
    // Force-focus and press Enter to verify disabled activation stays ignored.
    zonesBtn.focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("attaches an outlined house to the active tab and saves without switching views", async () => {
    const onChange = vi.fn();
    const onHomeChange = vi.fn();
    const { container } = render(
      <SegmentedControl
        options={OPTIONS}
        value="zones"
        homeValue="events"
        onChange={onChange}
        onHomeChange={onHomeChange}
      />,
    );
    const house = screen.getByRole("button", { name: "Направи „Моите зони“ начален изглед" });
    expect(house).not.toHaveAttribute("aria-disabled");
    expect(house).not.toHaveAttribute("aria-pressed");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(container.querySelector("button button")).toBeNull();

    await userEvent.click(house);

    expect(onHomeChange).toHaveBeenCalledExactlyOnceWith("zones");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves the house with the active tab and fills it only for the saved home", async () => {
    const onHomeChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl options={OPTIONS} value="zones" homeValue="zones" onChange={vi.fn()} onHomeChange={onHomeChange} />,
    );
    const filledHouse = screen.getByRole("button", { name: "Информация за началния изглед „Моите зони“" });
    expect(filledHouse).toBeEnabled();
    expect(filledHouse).not.toHaveAttribute("aria-disabled");
    expect(filledHouse).toHaveAttribute("title", "„Моите зони“ е началният ти изглед");
    expect(filledHouse).toHaveAccessibleDescription(
      "За да смениш началния изглед, избери друг изглед и натисни къщичката му.",
    );
    await userEvent.click(filledHouse);
    expect(onHomeChange).toHaveBeenCalledExactlyOnceWith("zones");
    onHomeChange.mockClear();

    rerender(<SegmentedControl options={OPTIONS} value="events" homeValue="zones" onChange={vi.fn()} onHomeChange={onHomeChange} />);
    expect(filledHouse).toBeDisabled();
    expect(filledHouse).toHaveAttribute("tabindex", "-1");
    await userEvent.click(filledHouse);
    expect(onHomeChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Информация за началния изглед „Моите зони“" })).not.toBeInTheDocument();
    const outlinedHouse = screen.getByRole("button", { name: "Направи „Събития“ начален изглед" });
    expect(outlinedHouse).not.toHaveAttribute("aria-disabled");

    rerender(<SegmentedControl options={OPTIONS} value="zones" homeValue="zones" onChange={vi.fn()} onHomeChange={onHomeChange} />);
    expect(outlinedHouse).toBeDisabled();
    await userEvent.click(outlinedHouse);
    expect(onHomeChange).not.toHaveBeenCalled();
  });

  it("supports keyboard selection followed by the separate house action", async () => {
    const options = [
      { value: "all", label: "Всички" },
      { value: "nearby", label: "Около мен" },
      { value: "zones", label: "Моите зони" },
    ];
    function KeyboardExample() {
      const [view, setView] = useState("all");
      const [home, setHome] = useState("all");
      return <SegmentedControl options={options} value={view} homeValue={home} onChange={setView} onHomeChange={setHome} />;
    }
    render(<KeyboardExample />);
    screen.getByRole("radio", { name: "Всички" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Около мен" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Направи „Около мен“ начален изглед" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const savedHome = screen.getByRole("button", { name: "Информация за началния изглед „Около мен“" });
    expect(savedHome).toBeEnabled();
    expect(savedHome).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(savedHome).toHaveFocus();
  });
});
