"use client";

import { useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import MessageCard, { MessageCardSkeleton } from "@/components/MessageCard";
import MessageDetailView from "@/components/MessageDetailView/MessageDetailView";
import GitHubIcon from "@/components/icons/GitHubIcon";
import type { InternalMessage, IngestError, Message } from "@/lib/types";
import { navigateBackOrReplace } from "@/lib/navigation-utils";
import { getButtonClasses } from "@/lib/theme";
import { useMessageByIdFallback } from "@/lib/hooks/useMessageByIdFallback";
import { GITHUB_REPO } from "@/lib/github";

const PAGE_SIZE = 12;

// NEXT_PUBLIC_BASE_URL is enforced at app startup in layout.tsx
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL!;
const MAX_URL_LENGTH = 8000;
const MAX_INGEST_ERRORS_IN_GITHUB_BODY = 20;

function buildGitHubIssueUrl(message: InternalMessage): string {
  const messageUrl = `${BASE_URL}/ingest-errors?messageId=${encodeURIComponent(String(message.id))}`;
  const rawErrors = message.ingestErrors ?? [];
  const limitedErrors = rawErrors.slice(0, MAX_INGEST_ERRORS_IN_GITHUB_BODY);

  // Escape sequences of 3+ backticks in error text so they don't close the code fence
  const escapeBackticks = (text: string) =>
    text.replace(/`{3,}/g, (m) => m.split("").join("\u200B"));

  let errorsContent = limitedErrors
    .map((e: IngestError) => `- [${e.type}] ${escapeBackticks(e.text)}`)
    .join("\n");

  if (rawErrors.length > limitedErrors.length) {
    const remaining = rawErrors.length - limitedErrors.length;
    const suffixLine = `- ... (${remaining} more error${remaining === 1 ? "" : "s"} truncated)`;
    errorsContent = errorsContent
      ? `${errorsContent}\n${suffixLine}`
      : suffixLine;
  }

  const title = `Ingest error: ${message.id}`;
  const header = `**Съобщение:** ${messageUrl}\n\n**Проблеми при обработка:**\n`;
  const openFence = "```\n";
  const closeFence = "\n```";

  const buildUrl = (issueBody: string) =>
    `https://github.com/${GITHUB_REPO}/issues/new?${new URLSearchParams({ title, body: issueBody })}`;

  const buildBody = (content: string) =>
    `${header}${openFence}${content}${closeFence}`;

  if (buildUrl(buildBody(errorsContent)).length <= MAX_URL_LENGTH) {
    return buildUrl(buildBody(errorsContent));
  }

  // Truncate only the errors content so the code fence is always properly closed
  const truncSuffix = "\n(truncated)" + closeFence;
  let low = 0;
  let high = errorsContent.length;
  let bestContent = truncSuffix;

  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    // Never cut through a surrogate pair (non-BMP character)
    if (mid > 0 && mid < errorsContent.length) {
      const prevCode = errorsContent.charCodeAt(mid - 1);
      const nextCode = errorsContent.charCodeAt(mid);
      if (
        prevCode >= 0xd800 &&
        prevCode <= 0xdbff &&
        nextCode >= 0xdc00 &&
        nextCode <= 0xdfff
      ) {
        mid -= 1;
      }
    }
    const candidate = errorsContent.slice(0, mid) + truncSuffix;
    if (
      buildUrl(`${header}${openFence}${candidate}`).length <= MAX_URL_LENGTH
    ) {
      bestContent = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return buildUrl(`${header}${openFence}${bestContent}`);
}

type IngestErrorsCursor = {
  finalizedAt: string;
  id: string;
};

type IngestErrorsResponse = {
  messages: InternalMessage[];
  nextCursor?: IngestErrorsCursor;
};

const fetchIngestErrors = async ({
  pageParam,
}: {
  pageParam?: IngestErrorsCursor;
}): Promise<IngestErrorsResponse> => {
  const params = new URLSearchParams();

  if (pageParam) {
    params.set("cursorFinalizedAt", pageParam.finalizedAt);
    params.set("cursorId", pageParam.id);
  }

  const response = await fetch(`/api/messages/ingest-errors?${params}`);

  if (!response.ok) {
    throw new Error("Failed to fetch ingest error messages");
  }

  return response.json();
};

function IngestErrorsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteQuery({
    queryKey: ["ingestErrors"],
    queryFn: fetchIngestErrors,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const messages = useMemo(
    () => data?.pages.flatMap((page) => page.messages) ?? [],
    [data],
  );

  const messageId = searchParams.get("messageId");

  const listMatch = useMemo(
    () => messages.find((message) => message.id === messageId) ?? null,
    [messageId, messages],
  );

  const selectedMessage = useMessageByIdFallback(messageId, listMatch);

  const handleMessageClick = useCallback(
    (message: Message) => {
      const url = `/ingest-errors?messageId=${encodeURIComponent(String(message.id))}`;
      router.push(url, { scroll: false });
    },
    [router],
  );

  const handleCloseDetail = useCallback(() => {
    navigateBackOrReplace(router, "/ingest-errors");
  }, [router]);

  const isEmpty = !isLoading && messages.length === 0;
  const isLoadingCards = isLoading || isFetchingNextPage;

  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>Начало</span>
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8 border border-neutral-border">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Съобщения с проблеми при обработка
            </h1>
            <p className="text-sm text-neutral">
              Финализирани съобщения без GeoJSON, които съдържат записи за
              проблеми при обработка.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-error-border bg-error-light p-4 text-error">
            Грешка при зареждане на съобщенията. Опитай отново.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading &&
            Array.from({ length: PAGE_SIZE }, (_, index) => (
              <MessageCardSkeleton key={`skeleton-${index}`} />
            ))}

          {!isLoading &&
            messages.map((message) => {
              const ingestErrors = message.ingestErrors ?? [];
              const hasErrors = ingestErrors.length > 0;
              return (
                <div key={message.id} className="flex flex-col">
                  <MessageCard
                    message={message}
                    onClick={handleMessageClick}
                    className={
                      hasErrors ? "rounded-b-none border-b-0" : undefined
                    }
                  />
                  {hasErrors && (
                    <div className="rounded-b-lg border border-t-0 border-error-border bg-error-light text-error p-3 text-xs space-y-2">
                      <p className="font-semibold">Проблеми при обработка</p>
                      <ul className="list-disc list-inside space-y-1">
                        {ingestErrors.map((error, index) => (
                          <li
                            key={`${error.type}-${index}`}
                            className="break-words"
                          >
                            {error.text}
                          </li>
                        ))}
                      </ul>
                      <div className="pt-1">
                        <a
                          href={buildGitHubIssueUrl(message)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-error hover:underline"
                        >
                          <GitHubIcon className="size-4 shrink-0" />
                          Създай issue в GitHub
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          {isEmpty && (
            <div className="col-span-full text-center text-neutral py-8">
              Няма налични съобщения
            </div>
          )}
        </div>

        {hasNextPage && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => {
                fetchNextPage();
              }}
              className={getButtonClasses("ghost", "lg", "sm")}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Зареждане..." : "Покажи още"}
            </button>
          </div>
        )}

        {isLoadingCards && !isLoading && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }, (_, index) => (
              <MessageCardSkeleton key={`loading-${index}`} />
            ))}
          </div>
        )}
      </div>

      <MessageDetailView
        message={selectedMessage}
        onClose={handleCloseDetail}
        onAddressClick={(lat, lng) => {
          router.push(`/?lat=${lat}&lng=${lng}`, { scroll: false });
        }}
      />
    </div>
  );
}

export default function IngestErrorsPage() {
  return (
    <Suspense>
      <IngestErrorsPageContent />
    </Suspense>
  );
}
