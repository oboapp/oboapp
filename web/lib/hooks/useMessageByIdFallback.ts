import { useEffect, useMemo, useRef, useState } from "react";
import { isValidMessageId } from "@oboapp/shared";
import type { Message } from "@/lib/types";

/**
 * Resolves a selected message from a URL `messageId` parameter.
 *
 * First checks `listMatch` (a message already present in the loaded list).
 * When `listMatch` is null and `messageId` is valid, fetches the message from
 * `/api/messages/by-id` so that deep links to older messages always open the
 * detail view without requiring the user to paginate.
 *
 * @param messageId - The message ID from the URL search params (or null)
 * @param listMatch - The message found in the already-loaded list, or null
 * @returns The resolved message to display, or null
 */
export function useMessageByIdFallback(
  messageId: string | null,
  listMatch: Message | null,
): Message | null {
  const [fetchedMessage, setFetchedMessage] = useState<{
    id: string;
    message: Message;
  } | null>(null);

  // Tracks the messageId for which a fetch has been initiated, so the effect
  // doesn't start a duplicate request within a single render cycle.
  // The ref is cleared in cleanup and on error so that cancellation or failure
  // never permanently blocks a retry for the same messageId.
  const fetchedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!messageId || !isValidMessageId(messageId)) {
      fetchedIdRef.current = null;
      return;
    }

    if (listMatch) {
      return;
    }

    if (fetchedIdRef.current === messageId) {
      return;
    }

    fetchedIdRef.current = messageId;
    const controller = new AbortController();

    fetch(`/api/messages/by-id?id=${encodeURIComponent(messageId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => {
        if (data?.message) {
          setFetchedMessage({ id: messageId, message: data.message });
        }
      })
      .catch((err: unknown) => {
        // On a real error (not an intentional abort), clear the ref so a future
        // navigation to the same messageId can retry.
        const isAbort =
          typeof err === "object" &&
          err !== null &&
          "name" in err &&
          err.name === "AbortError";
        if (!isAbort) {
          fetchedIdRef.current = null;
        }
      });

    return () => {
      controller.abort();
      // Clear the ref so that if messageId returns to this value after
      // unmounting or a deps change, a fresh fetch will be started.
      fetchedIdRef.current = null;
    };
  }, [messageId, listMatch]);

  return useMemo(() => {
    if (!messageId) return null;
    if (listMatch) return listMatch;
    if (fetchedMessage?.id === messageId) return fetchedMessage.message;
    return null;
  }, [messageId, listMatch, fetchedMessage]);
}
