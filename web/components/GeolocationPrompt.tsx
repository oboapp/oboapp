"use client";

import { trackEvent } from "@/lib/analytics";
import { zIndex } from "@/lib/colors";
import { buttonStyles, buttonSizes } from "@/lib/theme";

interface GeolocationPromptProps {
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

/**
 * Non-blocking toast banner for geolocation permission.
 * Appears at the bottom of the map instead of as a blocking modal.
 * Follows the "value before ask" principle — users can dismiss and continue exploring.
 */
export default function GeolocationPrompt({
  onAccept,
  onDecline,
}: GeolocationPromptProps) {
  const handleAccept = () => {
    trackEvent({
      name: "geolocation_prompt_accepted",
      params: {},
    });
    onAccept();
  };

  const handleDecline = () => {
    trackEvent({
      name: "geolocation_prompt_declined",
      params: {},
    });
    onDecline();
  };

  return (
    <div
      className={`animate-fade-in fixed bottom-20 left-1/2 -translate-x-1/2 ${zIndex.fixed} pointer-events-auto w-[calc(100%-2rem)] max-w-sm`}
    >
      <div className="bg-white rounded-lg shadow-lg border border-neutral-border p-3 flex items-center gap-3">
        <svg
          className="w-8 h-8 flex-shrink-0 text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M22 12h-4M6 12H2M12 6V2M12 18v4" />
        </svg>
        <p className="flex-1 text-sm text-foreground">
          Покажи събитията близо до мен
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleDecline}
            className={`${buttonSizes.sm} ${buttonStyles.secondary} rounded-md text-xs`}
          >
            Не
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className={`${buttonSizes.sm} ${buttonStyles.primary} rounded-md text-xs`}
          >
            Разреши
          </button>
        </div>
      </div>
    </div>
  );
}
