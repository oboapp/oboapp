"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  useParams,
  useRouter,
  useSearchParams,
  notFound,
} from "next/navigation";
import { useMessageByIdFallback } from "@/lib/hooks/useMessageByIdFallback";
import Link from "next/link";
import Image from "next/image";
import { Message, SourceConfig } from "@/lib/types";
import MessagesGrid from "@/components/MessagesGrid";
import MessageDetailView from "@/components/MessageDetailView/MessageDetailView";
import sourcesData from "@/lib/sources.json";
import { extractHostname } from "@/lib/url-utils";
import { navigateBackOrReplace } from "@/lib/navigation-utils";

export default function SourcePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceId = typeof params.sourceId === "string" ? params.sourceId : "";

  // Find source in sources.json
  const source = useMemo(() => {
    const allSources: SourceConfig[] = sourcesData;
    return allSources.find((s) => s.id === sourceId);
  }, [sourceId]);

  // Validate source exists - redirect to 404 if not
  useEffect(() => {
    if (!source) {
      notFound();
    }
  }, [source]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [logoError, setLogoError] = useState(false);

  // Fetch messages for this source
  useEffect(() => {
    // TODO: Replace manual fetch with react-query for caching and pagination.
    const fetchMessages = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/messages/by-source?sourceId=${encodeURIComponent(sourceId)}&limit=12`,
        );
        const data = await response.json();
        setMessages(data.messages || []);
      } catch (error) {
        console.error("Error fetching messages:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (source) {
      fetchMessages();
    }
  }, [sourceId, source]);

  const messageId = searchParams.get("messageId");

  const listMatch = useMemo(
    () => messages.find((m) => m.id === messageId) ?? null,
    [messageId, messages],
  );

  const selectedMessage = useMessageByIdFallback(messageId, listMatch);

  // Handle message click
  const handleMessageClick = useCallback(
    (message: Message) => {
      // Stay on sources page with query param to keep source context
      const messageUrl = `/sources/${sourceId}?messageId=${encodeURIComponent(String(message.id))}`;
      router.push(messageUrl, {
        scroll: false,
      });
    },
    [router, sourceId],
  );

  // Handle closing detail view
  const handleCloseDetail = useCallback(() => {
    navigateBackOrReplace(router, `/sources/${sourceId}`);
  }, [router, sourceId]);

  // Handle address click - navigate to homepage with message and location
  const handleAddressClick = useCallback(
    (lat: number, lng: number) => {
      const url = `/?lat=${lat}&lng=${lng}`;
      router.push(url, { scroll: false });
    },
    [router],
  );

  if (!source) {
    return null; // Will redirect to 404
  }

  const logoPath = `/sources/${source.id}.png`;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/sources"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>Всички източници</span>
          </Link>
        </div>

        {/* Source header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8 border border-neutral-border">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Logo */}
            <div className="flex-shrink-0">
              {logoError ? (
                <div className="w-24 h-24 sm:w-32 sm:h-32 bg-neutral-light rounded-lg flex items-center justify-center">
                  <svg
                    className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400"
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
                  alt={source.name}
                  width={128}
                  height={128}
                  className="w-24 h-24 sm:w-32 sm:h-32 object-contain rounded-lg"
                  onError={() => setLogoError(true)}
                />
              )}
            </div>

            {/* Name and URL */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                {source.name}
              </h1>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary-hover text-sm font-medium underline break-all inline-block"
              >
                {extractHostname(source.url)}
              </a>
            </div>
          </div>
        </div>

        {/* Messages grid */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Последни съобщения
          </h2>
          <MessagesGrid
            messages={messages}
            isLoading={isLoading}
            onMessageClick={handleMessageClick}
            limit={12}
          />
        </div>
      </div>

      {/* Message Detail View */}
      <MessageDetailView
        message={selectedMessage}
        onClose={handleCloseDetail}
        onAddressClick={handleAddressClick}
      />
    </div>
  );
}
