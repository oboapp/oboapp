import React, { useState } from "react";
import Image from "next/image";
import { trackEvent } from "@/lib/analytics";
import sources from "@/lib/sources";
import DetailItem from "./DetailItem";

interface SourceProps {
  readonly sourceId: string;
  readonly sourceUrl?: string;
}

function SourceContent({
  logoError,
  logoPath,
  source,
  sourceId,
  onLogoError,
}: {
  readonly logoError: boolean;
  readonly logoPath: string;
  readonly source: { name: string } | undefined;
  readonly sourceId: string;
  readonly onLogoError: () => void;
}) {
  const logo = logoError ? (
    <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
      <svg
        className="w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    </div>
  ) : (
    <Image
      src={logoPath}
      alt={source?.name || sourceId}
      width={24}
      height={24}
      className="w-6 h-6 object-contain rounded flex-shrink-0"
      onError={() => onLogoError()}
    />
  );

  return (
    <>
      {logo}
      <span className="text-base text-gray-900">
        {source?.name || sourceId}
      </span>
    </>
  );
}

export default function SourceDisplay({ sourceId, sourceUrl }: SourceProps) {
  const [logoError, setLogoError] = useState(false);
  const source = sources.find((s) => s.id === sourceId);
  const logoPath = `/sources/${sourceId}.png`;
  const isValidUrl = sourceUrl?.startsWith("https://");

  const content = (
    <SourceContent
      logoError={logoError}
      logoPath={logoPath}
      source={source}
      sourceId={sourceId}
      onLogoError={() => setLogoError(true)}
    />
  );

  return (
    <DetailItem title="Източник">
      <div className="flex items-center space-x-2">
        {isValidUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Отвори ${source?.name || sourceId} в нов таб`}
            className="flex items-center space-x-2 underline underline-offset-2"
            onClick={() => {
              trackEvent({
                name: "external_link_clicked",
                params: {
                  url: sourceUrl || "",
                  location: "message_detail",
                  source_id: sourceId,
                  source_name: source?.name,
                },
              });
            }}
          >
            {content}
            <svg
              className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        ) : (
          content
        )}
      </div>
    </DetailItem>
  );
}
