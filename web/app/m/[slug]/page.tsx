import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidMessageId } from "@oboapp/shared";
import { getDb } from "@/lib/db";
import { recordToInternalMessage } from "@/lib/doc-to-message";
import type { InternalMessage } from "@/lib/types";
import { hasValidSourceUrl } from "@/lib/url-utils";
import {
  messageMetadata,
  messageStructuredData,
  safeJsonLd,
} from "@/lib/message-page-metadata";
import MessageText from "@/components/MessageDetailView/MessageText";
import AiProcessedNotice from "@/components/MessageDetailView/AiProcessedNotice";

type Props = { params: Promise<{ slug: string }> };

const getMessage = cache(async (id: string): Promise<InternalMessage | null> => {
  if (!isValidMessageId(id)) return null;
  const db = await getDb();
  const record = await db.messages.findById(id);
  return record ? recordToInternalMessage(record) : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const message = await getMessage(slug);
  return message ? messageMetadata(message) : {};
}

export default async function MessagePage({ params }: Props) {
  const { slug } = await params;
  const message = await getMessage(slug);
  if (!message) notFound();

  const sourceUrl = hasValidSourceUrl(message.sourceUrl)
    ? message.sourceUrl
    : undefined;
  const jsonLd = safeJsonLd(messageStructuredData(message));

  return (
    <article className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 text-foreground sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">Сигнал</h1>
        {message.finalizedAt && (
          <p className="text-sm text-neutral">
            Публикувано тук: {new Date(message.finalizedAt).toLocaleDateString("bg-BG", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
        {message.source && (
          <p className="text-sm text-neutral">
            Източник:{" "}
            {sourceUrl ? (
              <a href={sourceUrl} className="underline underline-offset-2">
                {message.source}
              </a>
            ) : (
              message.source
            )}
          </p>
        )}
      </header>

      <section aria-label="Текст" className="space-y-4">
        <MessageText
          text={message.text}
          markdownText={message.summary ?? message.markdownText}
        />
        {message.summary && (
          <p className="text-neutral">
            Съдържанието е съкратено от AI.
            {sourceUrl && (
              <>
                {" "}Виж{" "}
                <a href={sourceUrl} className="underline underline-offset-2">
                  оригиналния източник
                </a>
                .
              </>
            )}
          </p>
        )}
        {!message.summary && message.aiProcessed && (
          <AiProcessedNotice sourceUrl={sourceUrl} />
        )}
      </section>

      <Link
        href={`/?messageId=${encodeURIComponent(slug)}`}
        className="inline-block rounded-md border border-neutral-border px-4 py-2 underline underline-offset-2"
      >
        Виж на картата
      </Link>
    </article>
  );
}
