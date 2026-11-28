import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MessageShareButton from "./MessageShareButton";

const data = {
  title: "Ремонт на водопровод | OboApp",
  text: "Ремонт на водопровод в София",
  url: "https://example.org/m/A1234567",
};

const gtag = vi.fn();
const writeText = vi.fn();

function clickShare() {
  render(<MessageShareButton messageId="A1234567" data={data} />);
  fireEvent.click(screen.getByRole("button", { name: "Сподели със съсед" }));
}

describe("sharing a disruption", () => {
  beforeEach(() => {
    gtag.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "test-measurement");
    vi.stubGlobal("gtag", gtag);
    localStorage.setItem("ga_consent", "granted");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("ga_consent");
    vi.unstubAllEnvs();
  });

  it("hands the public link and incident details to the native share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    clickShare();
    expect(share).toHaveBeenCalledExactlyOnceWith(data);
    await waitFor(() => {
      expect(gtag).toHaveBeenCalledExactlyOnceWith("event", "message_shared", {
        message_id: "A1234567", method: "native",
      });
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies only the canonical URL when native sharing is unavailable", async () => {
    const share = vi.fn();
    vi.stubGlobal("navigator", { share, canShare: () => false, clipboard: { writeText } });
    clickShare();
    expect(await screen.findByText("Връзката е копирана.")).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(data.url);
    expect(gtag).toHaveBeenCalledExactlyOnceWith("event", "message_shared", {
      message_id: "A1234567", method: "copy",
    });
  });

  it("copies without tracking when consent is denied", async () => {
    localStorage.setItem("ga_consent", "denied");
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    clickShare();
    expect(await screen.findByText("Връзката е копирана.")).toBeInTheDocument();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("can copy a link when the browser blocks access to consent storage", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
    clickShare();
    expect(await screen.findByText("Връзката е копирана.")).toBeInTheDocument();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("silently returns to the button after the native share is cancelled", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    clickShare();
    await waitFor(() => {
      expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "false");
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(writeText).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("offers a fresh copy action if the native share fails", async () => {
    const share = vi.fn().mockRejectedValue(new Error("Sharing disabled"));
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    clickShare();
    const copy = await screen.findByRole("button", { name: "Копирай връзката" });
    expect(screen.getByRole("status")).toHaveTextContent("Споделянето не успя.");
    expect(gtag).not.toHaveBeenCalled();
    fireEvent.click(copy);
    expect(await screen.findByText("Връзката е копирана.")).toBeInTheDocument();
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(data.url);
  });

  it("shows a selectable public URL if the clipboard is denied", async () => {
    writeText.mockRejectedValue(new Error("Clipboard denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    clickShare();
    const input = await screen.findByRole("textbox", { name: "Връзка към сигнала" });
    expect(input).toHaveValue(data.url);
    expect(screen.getByRole("status")).toHaveTextContent("Копирай връзката ръчно.");
    expect(gtag).not.toHaveBeenCalled();
  });
});
