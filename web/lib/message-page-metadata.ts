import type { Metadata } from "next";
import type { Message } from "@/lib/types";
import { stripHtmlTags } from "@oboapp/shared";
import { hasValidSourceUrl } from "@/lib/url-utils";

function stripMarkdownLinks(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf("[", cursor);
    const middle = open < 0 ? -1 : text.indexOf("](", open + 1);
    const close = middle < 0 ? -1 : text.indexOf(")", middle + 2);
    if (close < 0) return result + text.slice(cursor);

    const image = open > cursor && text[open - 1] === "!";
    result += text.slice(cursor, image ? open - 1 : open);
    if (!image) result += text.slice(open + 1, middle);
    cursor = close + 1;
  }

  return result;
}

function markdownToPlainText(markdown: string): string {
  return stripMarkdownLinks(stripHtmlTags(markdown))
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/gm, "")
    .replace(/(\*\*|__|~~|`)(.*?)\1/g, "$2")
    .replace(/(?<!\w)[*_]([^*_]+)[*_](?!\w)/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll(/&#(?:x27|39);/g, "'")
    .replaceAll("&amp;", "&");
}

function visibleText(message: Message): string {
  const formatted = message.summary ?? message.markdownText;
  return (formatted ? markdownToPlainText(formatted) : message.text)
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export function messageUrl(id: string): string {
  return new URL(`/m/${id}`, process.env.NEXT_PUBLIC_BASE_URL).toString();
}

export function messageMetadata(message: Message): Metadata {
  const id = message.id!;
  const content = visibleText(message);
  const title = shorten(content, 80) || "Сигнал";
  const description = shorten(content, 200);
  const url = messageUrl(id);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      publishedTime: message.finalizedAt,
      locale: "bg_BG",
      siteName: "OboApp",
    },
    twitter: { card: "summary", title, description },
  };
}

export function messageStructuredData(message: Message) {
  const url = messageUrl(message.id!);
  const content = visibleText(message);
  let digitalSourceType: string | undefined;
  if (message.summary) {
    digitalSourceType =
      "https://schema.org/TrainedAlgorithmicMediaDigitalSource";
  } else if (message.aiProcessed) {
    digitalSourceType =
      "https://schema.org/CompositeWithTrainedAlgorithmicMediaDigitalSource";
  }

  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": url,
    url,
    identifier: message.id,
    name: shorten(content, 80) || "Сигнал",
    description: shorten(content, 200),
    text: content,
    inLanguage: "bg",
    dateCreated: message.createdAt,
    ...(message.finalizedAt && { datePublished: message.finalizedAt }),
    ...(hasValidSourceUrl(message.sourceUrl) && {
      isBasedOn: message.sourceUrl,
    }),
    ...(digitalSourceType && { digitalSourceType }),
  };
}

export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", String.raw`\u003c`);
}
