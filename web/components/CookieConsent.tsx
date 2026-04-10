"use client";

import { useState } from "react";
import { hasConsentDecision, setConsent, initGA } from "@/lib/analytics";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { borderRadius, zIndex } from "@/lib/colors";

export default function CookieConsent() {
  const [isVisible, setIsVisible] = useState(() => {
    // Only check on client side and show banner only if user hasn't made a decision yet
    if (typeof window !== "undefined") {
      return !hasConsentDecision();
    }
    return false;
  });

  const handleAccept = () => {
    setConsent(true);
    setIsVisible(false);
    initGA();
  };

  const handleDecline = () => {
    setConsent(false);
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className={`fixed bottom-2 left-1/2 -translate-x-1/2 ${zIndex.overlay} w-[calc(100%-1rem)] sm:w-auto sm:max-w-4xl`}>
      <div className="bg-white rounded-lg shadow-md py-1.5 px-3 sm:py-2 sm:px-4 sm:opacity-70 sm:hover:opacity-100 transition-opacity duration-200">
        {/* Mobile compact view with icon buttons */}
        <div className="flex sm:hidden items-center gap-2">
          <p className="text-sm text-neutral flex-1">
            Използваме бисквитки за анализ на трафика.
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleDecline}
              className="w-8 h-8 flex items-center justify-center bg-neutral-light hover:bg-neutral-border text-neutral rounded-lg font-bold text-lg"
              aria-label="Откажи"
            >
              ✕
            </button>
            <button
              type="button"
              onClick={handleAccept}
              className="w-8 h-8 flex items-center justify-center bg-primary hover:bg-primary-hover text-white rounded-lg font-bold text-lg"
              aria-label="Приеми"
            >
              ✓
            </button>
          </div>
        </div>

        {/* Desktop single-line view */}
        <div className="hidden sm:flex items-center gap-4">
          <p className="text-sm text-neutral flex-1">
            Използваме бисквитки за анализ на трафика.
          </p>
          <div className="flex gap-2 whitespace-nowrap">
            <button
              type="button"
              onClick={handleDecline}
              className={`${buttonSizes.sm} font-medium ${buttonStyles.secondary} ${borderRadius.md}`}
            >
              Откажи
            </button>
            <button
              type="button"
              onClick={handleAccept}
              className={`${buttonSizes.sm} font-medium ${buttonStyles.primary} ${borderRadius.md}`}
            >
              Приеми
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
