import ExternalLinkIcon from "@/components/icons/ExternalLinkIcon";
import { hasValidSourceUrl } from "@/lib/url-utils";

export { hasValidSourceUrl };

interface AiProcessedNoticeProps {
  readonly sourceUrl?: string;
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
            <ExternalLinkIcon
              className="h-3.5 w-3.5 text-neutral"
              data-testid="external-link-icon"
            />
          </a>
          .
        </>
      )}
    </p>
  );
}
