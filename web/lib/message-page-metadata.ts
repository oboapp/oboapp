import type { Metadata } from "next";
import type { Message } from "@/lib/types";
import { LOCALITY_METADATA, stripHtmlTags } from "@oboapp/shared";
import { hasValidSourceUrl } from "@/lib/url-utils";
import { APP_NAME } from "@/lib/pwa-metadata";

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
  const formatted =
    message.summary || message.markdownText || message.plainText || message.text;
  return markdownToPlainText(formatted).replace(/\s+/g, " ").trim();
}

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export function messageUrl(id: string): string {
  return new URL(`/m/${id}`, process.env.NEXT_PUBLIC_BASE_URL).toString();
}

const disruptionTime = new Intl.DateTimeFormat("bg-BG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Sofia",
});

function shareTimespan(message: Message): string {
  const start = Date.parse(message.timespanStart ?? "");
  const end = Date.parse(message.timespanEnd ?? "");
  if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
    return disruptionTime.formatRange(start, end);
  }
  if (Number.isFinite(start)) {
    return `От ${disruptionTime.format(start)}`;
  }
  if (Number.isFinite(end)) {
    return `До ${disruptionTime.format(end)}`;
  }
  return "";
}

/** The same public description accompanies native shares and social previews. */
export function messageShareData(message: Message, id: string) {
  const content = visibleText(message);
  const location =
    message.addresses?.[0]?.formattedAddress ||
    message.pins?.[0]?.address ||
    message.streets?.[0]?.street ||
    message.busStops?.[0] ||
    LOCALITY_METADATA[message.locality]?.name ||
    "";
  const excerpt = shorten(content, 180);
  const where = location && !excerpt.includes(location) ? shorten(location, 90) : "";
  const details = [where, shareTimespan(message)].filter(Boolean).join(" · ");
  return {
    title: `${shorten(content, 80) || "Сигнал"} | ${APP_NAME}`,
    text: [excerpt, details].filter(Boolean).join("\n") || "Сигнал",
    url: messageUrl(id),
  };
}

export function messageMetadata(message: Message): Metadata {
  const { title, text: description, url } = messageShareData(message, message.id!);

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
      siteName: APP_NAME,
      images: [{ url: new URL("/opengraph-image", url), alt: APP_NAME }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: new URL("/twitter-image", url), alt: APP_NAME }],
    },
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
