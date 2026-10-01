import type { Metadata } from "next";
import type { Message } from "@/lib/types";
import { stripMarkdown } from "@/lib/markdown-utils";
import { hasValidSourceUrl } from "@/lib/url-utils";

function visibleText(message: Message): string {
  const formatted = message.summary ?? message.markdownText;
  return (formatted ? stripMarkdown(formatted) : message.text)
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
    ...(message.summary
      ? {
          digitalSourceType:
            "https://schema.org/TrainedAlgorithmicMediaDigitalSource",
        }
      : message.aiProcessed
        ? {
            digitalSourceType:
              "https://schema.org/CompositeWithTrainedAlgorithmicMediaDigitalSource",
          }
        : {}),
  };
}

export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
