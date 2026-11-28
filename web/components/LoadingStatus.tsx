"use client";

import { useEffect, useRef, useState } from "react";

interface LoadingStatusProps {
  readonly isLoading: boolean;
  readonly loadingMessage: string;
  readonly finishedMessage: string;
}

export function LoadingStatus({
  isLoading,
  loadingMessage,
  finishedMessage,
}: LoadingStatusProps) {
  const [announcement, setAnnouncement] = useState("");
  const pending = useRef(false);

  useEffect(() => {
    if (!isLoading && !pending.current) {
      return;
    }
    if (isLoading) {
      pending.current = true;
    }

    // Register the empty live region before inserting its first announcement.
    const timer = globalThis.setTimeout(() => {
      setAnnouncement(isLoading ? loadingMessage : finishedMessage);
      pending.current = isLoading;
    }, 0);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [isLoading, loadingMessage, finishedMessage]);

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </span>
  );
}
