import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FacebookConnectPanel } from "./FacebookConnectPanel";
import type { FacebookConnectionView } from "@/lib/facebook-connect/types";

afterEach(() => {
  cleanup();
});

describe("FacebookConnectPanel", () => {
  it("requires explicit consent before starting the Facebook flow", async () => {
    render(<FacebookConnectPanel view={{ status: "intro", ready: true }} />);

    const consent = screen.getByRole("checkbox");
    const button = screen.getByRole("button", { name: "Продължи с Facebook" });
    const form = button.closest("form");
    expect(consent).toBeRequired();
    expect(consent).not.toBeChecked();
    expect(consent).toHaveAttribute("name", "consent");
    expect(consent).toHaveAttribute("value", "yes");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/integrations/facebook/start");
    expect(form?.checkValidity()).toBe(false);

    await userEvent.click(consent);

    expect(form?.checkValidity()).toBe(true);
    expect(screen.getByRole("link", { name: "информацията за данните" })).toHaveAttribute("href", "/connect/facebook/privacy");
  });

  it("explains preparation and disables connection when it is not ready", () => {
    render(<FacebookConnectPanel view={{ status: "intro", ready: false }} />);

    expect(screen.getByRole("heading", { name: "Подготвяме свързването" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продължи с Facebook" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Очаква се готовност за свързване");
  });

  it("submits only an explicitly selected Page ID and the selection CSRF value", async () => {
    render(
      <FacebookConnectPanel view={{
        status: "select",
        csrfToken: "selection-csrf",
        pages: [
          { id: "101", name: "Район Оборище" },
          { id: "202", name: "Район Студентски" },
        ],
      }} />,
    );

    const firstPage = screen.getByRole("radio", { name: "Район Оборище" });
    const secondPage = screen.getByRole("radio", { name: "Район Студентски" });
    const form = screen.getByRole("button", { name: "Свържи избраната страница" }).closest("form");
    expect(screen.getByRole("group", { name: "Избери страница за Обо" })).toBeInTheDocument();
    expect(firstPage).toBeRequired();
    expect(firstPage).not.toBeChecked();
    expect(secondPage).not.toBeChecked();
    expect(form?.checkValidity()).toBe(false);
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/integrations/facebook/select");

    await userEvent.click(secondPage);

    expect(form?.checkValidity()).toBe(true);
    expect(form).not.toBeNull();
    if (!form) {
      throw new Error("Expected Page selection form");
    }
    const values = new FormData(form);
    expect([...values.entries()]).toEqual([
      ["csrf", "selection-csrf"],
      ["pageId", "202"],
    ]);
  });

  it("offers a fresh connection when no pages are available", () => {
    render(<FacebookConnectPanel view={{ status: "select", pages: [], csrfToken: "csrf" }} />);

    expect(screen.getByRole("heading", { name: "Няма налични страници" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Свържи избраната страница" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Обратно към свързването" })).toHaveAttribute("href", "/connect/facebook");
  });

  it("confirms the Page and explains that collection awaits pilot confirmation", () => {
    render(<FacebookConnectPanel view={{ status: "connected", pageName: "Район Оборище" }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Страницата е свързана");
    expect(screen.getByRole("status")).toHaveTextContent("Район Оборище");
    expect(screen.getByRole("status")).toHaveTextContent("Събирането на публикации остава изключено.");
    expect(screen.getByRole("link", { name: "Управлявай достъпа във Facebook" })).toHaveAttribute("href", "https://www.facebook.com/settings?tab=business_tools");
  });

  it.each<{ code: Extract<FacebookConnectionView, { status: "error" }>["code"]; message: string }>([
    { code: "cancelled", message: "Свързването беше отменено." },
    { code: "expired", message: "Времето за потвърждение изтече." },
    { code: "permissions", message: "Липсва необходимият достъп до страница." },
    { code: "provider", message: "Facebook временно не отговори." },
    { code: "storage", message: "Свързването не беше запазено." },
    { code: "invalid", message: "Потвърждението е невалидно." },
    { code: "rate_limit", message: "Facebook временно ограничи заявките." },
    { code: "too_many_pages", message: "Избрани са твърде много страници." },
  ])("shows a useful retry path for $code", ({ code, message }) => {
    render(<FacebookConnectPanel view={{ status: "error", code }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Свързването не завърши");
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "Опитай отново" })).toHaveAttribute("href", "/connect/facebook");
    expect(screen.queryByRole("button", { name: "Продължи с Facebook" })).not.toBeInTheDocument();
  });
});
