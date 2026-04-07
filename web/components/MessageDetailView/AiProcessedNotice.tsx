interface AiProcessedNoticeProps {
  readonly sourceUrl?: string;
}

export function hasValidSourceUrl(sourceUrl?: string): boolean {
  if (!sourceUrl) {
    return false;
  }

  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AiProcessedNotice({
  sourceUrl,
}: Readonly<AiProcessedNoticeProps>) {
  const showSourceHint = hasValidSourceUrl(sourceUrl);

  return (
    <p className="rounded-md border border-info-border bg-info-light p-3 text-sm text-neutral">
      Съдържанието е обработено от AI и може да съдържа неточности.
      {showSourceHint && sourceUrl && (
        <>
          {" "}
          За пълен контекст виж{" "}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="оригиналния източник (отваря се в нов таб)"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            <span>оригиналния източник</span>
            <svg
              className="h-3.5 w-3.5 text-neutral"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
              data-testid="external-link-icon"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
          .
        </>
      )}
    </p>
  );
}