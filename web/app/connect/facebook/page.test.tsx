import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FacebookConnectionPage from "./page";
import { getFacebookConnectionView } from "@/lib/facebook-connect/service";

vi.mock("next/headers", () => {
  return {
    cookies: async () => {
      return {
        get: () => {
          return { value: "existing-expired-session" };
        },
      };
    },
  };
});

vi.mock("@/lib/facebook-connect/service", () => {
  return {
    getFacebookConnectionView: vi.fn(async (cookie?: string) => {
      if (cookie) {
        return { status: "error", code: "expired" };
      }
      return { status: "intro", ready: true };
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens fresh consent on retry even when the browser retains an expired session", async () => {
  render(await FacebookConnectionPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("alert")).toHaveTextContent("Времето за потвърждение изтече.");
  const retry = screen.getByRole("link", { name: "Опитай отново" });
  const destination = new URL(retry.getAttribute("href") || "", "https://example.org");
  cleanup();

  render(await FacebookConnectionPage({ searchParams: Promise.resolve({
    restart: destination.searchParams.get("restart") || undefined,
  }) }));

  expect(screen.getByRole("checkbox")).toBeRequired();
  expect(screen.getByRole("button", { name: "Продължи с Facebook" })).toBeEnabled();
  expect(getFacebookConnectionView).toHaveBeenLastCalledWith(undefined, undefined);
});
