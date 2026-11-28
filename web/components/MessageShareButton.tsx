"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { getButtonClasses } from "@/lib/theme";

interface MessageShareButtonProps {
  readonly messageId: string;
  readonly data: { title: string; text: string; url: string };
}

type ShareState = "idle" | "busy" | "copied" | "offer-copy" | "manual-copy";

export default function MessageShareButton({
  messageId,
  data,
}: MessageShareButtonProps) {
  const [state, setState] = useState<ShareState>("idle");
  const copyOnly = state === "offer-copy" || state === "manual-copy";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(data.url);
    } catch {
      setState("manual-copy");
      return;
    }
    setState("copied");
    trackEvent({
      name: "message_shared",
      params: { message_id: messageId, method: "copy" },
    });
  }

  async function handleShare() {
    if (state === "busy") {
      return;
    }
    setState("busy");
    if (!copyOnly && typeof navigator.share === "function") {
      try {
        if (navigator.canShare && !navigator.canShare(data)) {
          await copyLink();
          return;
        }
        await navigator.share(data);
      } catch (error) {
        const cancelled = error instanceof Error && error.name === "AbortError";
        setState(cancelled ? "idle" : "offer-copy");
        return;
      }
      setState("idle");
      trackEvent({
        name: "message_shared",
        params: { message_id: messageId, method: "native" },
      });
      return;
    }
    await copyLink();
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        className={getButtonClasses(
          "ghost",
          "md",
          "sm",
          "inline-flex min-h-11 items-center gap-2 text-foreground",
        )}
        aria-disabled={state === "busy"}
        onClick={handleShare}
      >
        <Share2 size={16} aria-hidden="true" />
        {copyOnly ? "Копирай връзката" : "Сподели със съсед"}
      </button>
      <p role="status" className="text-sm text-neutral">
        {state === "copied" && "Връзката е копирана."}
        {state === "offer-copy" && "Споделянето не успя. Можеш да копираш връзката."}
        {state === "manual-copy" && "Копирането не успя. Копирай връзката ръчно."}
      </p>
      {state === "manual-copy" && (
        <input
          aria-label="Връзка към сигнала"
          className="mt-1 w-full rounded-md border border-neutral-border p-2 text-sm"
          readOnly
          value={data.url}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
      )}
    </div>
  );
}
