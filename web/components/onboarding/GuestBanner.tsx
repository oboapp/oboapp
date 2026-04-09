"use client";

import { useCallback } from "react";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { buttonStyles, buttonSizes } from "@/lib/theme";

/**
 * Persistent non-blocking banner for unauthenticated/anonymous users.
 * Shown at the bottom of the message list to encourage sign-in.
 * Replaces the old blocking LoginPrompt modal.
 */
export default function GuestBanner() {
  const { signInWithGoogle } = useAuth();

  const handleLogin = useCallback(async () => {
    trackEvent({ name: "login_initiated", params: { source: "prompt" } });
    try {
      await signInWithGoogle();
    } catch {
      globalThis.alert("Неуспешно влизане. Опитай отново.");
    }
  }, [signInWithGoogle]);

  return (
    <div className="mt-4 border border-neutral-border bg-neutral-light rounded-lg p-4 flex items-center gap-3">
      <p className="flex-1 text-sm text-neutral">
        Разглеждаш като гост — влез, за да запазиш зоните си на различни
        устройства.
      </p>
      <button
        type="button"
        onClick={() => {
          void handleLogin();
        }}
        className={`${buttonSizes.sm} ${buttonStyles.ghost} rounded-md flex-shrink-0`}
      >
        Влез с Google
      </button>
    </div>
  );
}
