import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { InternalMessage } from "@/lib/types";
import { buildMessagesUrl } from "./useMessages.utils";
import { debounce } from "@/lib/debounce";
import type { Category } from "@oboapp/shared";
import { CATEGORIES, UNCATEGORIZED } from "@oboapp/shared";

interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

interface MessagesOptions {
  readonly scope?: "viewport" | "all";
  readonly enabled?: boolean;
}

interface MessagesState {
  readonly url: string | null;
  readonly messages: InternalMessage[];
  readonly isLoading: boolean;
  readonly error: string | null;
}

const EMPTY_MESSAGES: InternalMessage[] = [];
const EMPTY_STATE: MessagesState = {
  url: null,
  messages: EMPTY_MESSAGES,
  isLoading: false,
  error: null,
};

function getMessagesError(error: unknown): string {
  if (!navigator.onLine) {
    return "Няма интернет връзка. Свържи се с интернет и презареди страницата.";
  }

  if (error instanceof TypeError && error.message.includes("fetch")) {
    return "Не успях да заредя събитията. Провери интернет връзката си и презареди страницата.";
  }

  return "Не успях да заредя събитията. Презареди страницата.";
}

/** Fetch recent events for the viewport or independently of the map. */
export function useMessages({
  scope = "viewport",
  enabled = true,
}: MessagesOptions = {}) {
  const [state, setState] = useState(EMPTY_STATE);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(
    null,
  );
  const [selectedCategories, setSelectedCategories] = useState<Set<
    Category | typeof UNCATEGORIZED
  > | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<string> | null>(
    null,
  );
  const [refreshVersion, setRefreshVersion] = useState(0);

  const availableCategories = useMemo<(Category | typeof UNCATEGORIZED)[]>(
    () => [...CATEGORIES, UNCATEGORIZED],
    [],
  );

  const queryBounds = scope === "viewport" ? viewportBounds : null;
  const requestUrl = useMemo(() => {
    if (!enabled || (scope === "viewport" && !queryBounds)) {
      return null;
    }

    let url = buildMessagesUrl(queryBounds);
    const params = new URLSearchParams();
    if (selectedCategories && selectedCategories.size > 0) {
      params.set("categories", Array.from(selectedCategories).join(","));
    }
    if (selectedSources && selectedSources.size > 0) {
      params.set("sources", Array.from(selectedSources).join(","));
    }

    const queryString = params.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
    return url;
  }, [enabled, scope, queryBounds, selectedCategories, selectedSources]);

  const fetchMessages = useCallback(async (url: string | null, signal: AbortSignal) => {
    if (!url) {
      setState(EMPTY_STATE);
      return;
    }

    setState((previous) => ({
      url,
      messages: previous.url === url ? previous.messages : EMPTY_MESSAGES,
      isLoading: true,
      error: null,
    }));

    try {
      const response = await fetch(url, { signal });
      if (signal.aborted) {
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch messages");
      }

      const data = await response.json();
      if (signal.aborted) {
        return;
      }

      setState({
        url,
        messages: Array.isArray(data.messages) ? data.messages : EMPTY_MESSAGES,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      setState((previous) => ({
        ...previous,
        isLoading: false,
        error: getMessagesError(error),
      }));
      console.error("Error fetching messages:", error);
    }
  }, []);

  const suppressBoundsChangeRef = useRef(false);
  const suppressionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suppressNextViewportFetch = useCallback(() => {
    suppressBoundsChangeRef.current = true;
    if (suppressionTimeoutRef.current) {
      clearTimeout(suppressionTimeoutRef.current);
    }
    suppressionTimeoutRef.current = setTimeout(() => {
      suppressBoundsChangeRef.current = false;
      suppressionTimeoutRef.current = null;
    }, 500);
  }, []);

  const [updateViewportBounds] = useState(() =>
    debounce((bounds: ViewportBounds) => {
      if (suppressBoundsChangeRef.current) {
        suppressBoundsChangeRef.current = false;
        return;
      }
      setViewportBounds(bounds);
    }, 300),
  );

  const handleBoundsChanged = useCallback((bounds: ViewportBounds) => {
    if (scope === "all") {
      // Remember the actual camera for Events without changing the all-events query.
      setViewportBounds(bounds);
      return;
    }
    updateViewportBounds(bounds);
  }, [scope, updateViewportBounds]);

  const resetViewport = useCallback(() => {
    updateViewportBounds.cancel();
    suppressBoundsChangeRef.current = false;
    if (suppressionTimeoutRef.current) {
      clearTimeout(suppressionTimeoutRef.current);
      suppressionTimeoutRef.current = null;
    }
    setViewportBounds(null);
  }, [updateViewportBounds]);

  useEffect(() => {
    return () => {
      updateViewportBounds.cancel();
      if (suppressionTimeoutRef.current) {
        clearTimeout(suppressionTimeoutRef.current);
        suppressionTimeoutRef.current = null;
      }
      suppressBoundsChangeRef.current = false;
    };
  }, [scope, updateViewportBounds]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMessages(requestUrl, controller.signal);
    return () => {
      controller.abort();
    };
  }, [requestUrl, refreshVersion, fetchMessages]);

  useEffect(() => {
    const refreshTimers = new Set<ReturnType<typeof setTimeout>>();
    const handleMessageSubmitted = () => {
      const timer = setTimeout(() => {
        refreshTimers.delete(timer);
        // The fetch effect uses the current scope, filters, and enabled state.
        setRefreshVersion((previous) => previous + 1);
      }, 2000);
      refreshTimers.add(timer);
    };

    globalThis.addEventListener("messageSubmitted", handleMessageSubmitted);
    return () => {
      globalThis.removeEventListener("messageSubmitted", handleMessageSubmitted);
      for (const timer of refreshTimers) {
        clearTimeout(timer);
      }
    };
  }, []);

  const isCurrentQuery = state.url === requestUrl;
  return {
    messages: requestUrl && isCurrentQuery ? state.messages : EMPTY_MESSAGES,
    availableCategories,
    isLoading: Boolean(requestUrl) && (!isCurrentQuery || state.isLoading),
    error: requestUrl && isCurrentQuery ? state.error : null,
    handleBoundsChanged,
    suppressNextViewportFetch,
    resetViewport,
    setSelectedCategories,
    setSelectedSources,
  };
}
