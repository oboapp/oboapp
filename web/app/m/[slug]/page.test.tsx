import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MessagePage, { generateMetadata } from "./page";

const { findByIdMock } = vi.hoisted(() => ({ findByIdMock: vi.fn() }));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({ messages: { findById: findByIdMock } }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const params = Promise.resolve({ slug: "aB3xYz12" });

function record(overrides: Record<string, unknown> = {}) {
  return {
    _id: "aB3xYz12",
    text: "Оригинален текст",
    createdAt: "2026-09-29T10:00:00.000Z",
    finalizedAt: "2026-09-29T10:05:00.000Z",
    locality: "sofia",
    source: "sofia-bg",
    sourceUrl: "https://example.org/original",
    aiProcessed: true,
    summary: "Кратко **съобщение** за ремонт.",
    ...overrides,
  };
}

function jsonLd(html: string): Record<string, unknown> {
  const match = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}

describe("shareable message page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_BASE_URL = "https://oboapp.online";
  });

  it("renders message-specific HTML, canonical metadata, and summary provenance", async () => {
    findByIdMock.mockResolvedValue(record());
    const html = renderToStaticMarkup(await MessagePage({ params }));
    const metadata = await generateMetadata({ params });
    const data = jsonLd(html);

    expect(html).toContain("Кратко");
    expect(html).toContain("Съдържанието е съкратено от AI.");
    expect(html).toContain("Виж на картата");
    expect(metadata.alternates?.canonical).toBe("https://oboapp.online/m/aB3xYz12");
    expect(metadata.description).toBe("Кратко съобщение за ремонт.");
    expect(data).toMatchObject({
      "@type": "CreativeWork",
      url: "https://oboapp.online/m/aB3xYz12",
      identifier: "aB3xYz12",
      text: "Кратко съобщение за ремонт.",
      isBasedOn: "https://example.org/original",
      dateCreated: "2026-09-29T10:00:00.000Z",
      datePublished: "2026-09-29T10:05:00.000Z",
      digitalSourceType: "https://schema.org/TrainedAlgorithmicMediaDigitalSource",
    });
  });

  it("marks AI processed content without claiming an AI summary or source", async () => {
    findByIdMock.mockResolvedValue(
      record({ summary: undefined, markdownText: "**Обработено** съобщение", sourceUrl: undefined }),
    );
    const html = renderToStaticMarkup(await MessagePage({ params }));
    const data = jsonLd(html);

    expect(html).toContain("Съдържанието е обработено от AI");
    expect(data.text).toBe("Обработено съобщение");
    expect(data.digitalSourceType).toBe(
      "https://schema.org/CompositeWithTrainedAlgorithmicMediaDigitalSource",
    );
    expect(data).not.toHaveProperty("isBasedOn");
  });

  it("does not mark non-AI messages as AI generated", async () => {
    findByIdMock.mockResolvedValue(record({ aiProcessed: false, summary: undefined, markdownText: undefined }));
    const html = renderToStaticMarkup(await MessagePage({ params }));
    const data = jsonLd(html);

    expect(html).toContain("Оригинален текст");
    expect(data).not.toHaveProperty("digitalSourceType");
    expect(html).not.toContain("обработено от AI");
  });

  it("escapes script-closing text in JSON-LD while keeping visible text", async () => {
    findByIdMock.mockResolvedValue(record({ summary: "Текст &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;" }));
    const html = renderToStaticMarkup(await MessagePage({ params }));

    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script>");
    expect(jsonLd(html).text).toContain("Текст");
  });

  it("returns not found for invalid and missing IDs", async () => {
    await expect(MessagePage({ params: Promise.resolve({ slug: "invalid!" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(findByIdMock).not.toHaveBeenCalled();
    findByIdMock.mockResolvedValue(null);
    await expect(MessagePage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
