"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { zIndex } from "@/lib/colors";
import UserSilhouetteIcon from "@/components/icons/UserSilhouetteIcon";

interface UserMenuProps {
  readonly id: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export default function UserMenu({ id, isOpen, onClose }: UserMenuProps) {
  const { user, guestAuthUnavailable, signOut, signInWithGoogle } = useAuth();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const showLoginAction = !user || user.isAnonymous;
  const isAnonymousUser = user?.isAnonymous ?? false;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    closeButtonRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));

      if (focusableElements.length === 0) {
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.window.addEventListener("keydown", handleEscape);
    return () => {
      globalThis.window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  const handleSignOut = () => {
    trackEvent({ name: "logout_clicked", params: { zones_count: 0 } });
    void signOut();
    onClose();
  };

  const handleLogin = async () => {
    trackEvent({ name: "login_initiated", params: { source: "header" } });
    try {
      await signInWithGoogle();
    } catch {
      window.alert("Неуспешно влизане. Опитай отново.");
    }
    onClose();
  };

  const userLabel = !user
    ? guestAuthUnavailable
      ? "Гост режим недостъпен"
      : "Сесията се подготвя"
    : isAnonymousUser
      ? "Гост"
      : user.displayName || user.email;

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Затвори менюто"
        onClick={onClose}
        className={`fixed inset-0 ${zIndex.overlay} bg-black/30`}
      />

      {/* Slide-in Panel */}
      <div
        id={id}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-menu-title"
        className={`fixed right-0 top-0 bottom-0 w-[300px] ${zIndex.overlayContent} bg-white shadow-2xl transition-transform duration-300 translate-x-0`}
      >
        {/* Close Button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral hover:text-neutral transition-colors"
          aria-label="Затвори менюто"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* User Info Section */}
        <div className="px-6 py-4 border-b border-neutral-border">
          <h2 id="user-menu-title" className="sr-only">
            Меню на потребителя
          </h2>
          <div className="flex items-center gap-3 mb-2">
            {user?.photoURL && (
              <Image
                src={user.photoURL}
                alt={user.displayName || "Потребител"}
                width={40}
                height={40}
                className="w-12 h-12 rounded-full"
              />
            )}
            {!user?.photoURL && (
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-neutral-border text-neutral">
                <UserSilhouetteIcon className="w-7 h-7" />
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {userLabel || "Потребител"}
              </p>
              {!user && (
                <p className="text-sm text-neutral truncate">
                  {guestAuthUnavailable
                    ? "Влез с Google, за да продължиш"
                    : "Изчакваме активна сесия"}
                </p>
              )}
              {!isAnonymousUser && user?.displayName && user?.email && (
                <p className="text-sm text-neutral truncate">{user.email}</p>
              )}
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="py-2">
          {/* Settings Link */}
          <Link
            href="/settings"
            onClick={onClose}
            className="block w-full px-6 py-3 text-left text-sm hover:bg-neutral-light transition-colors"
          >
            Настройки
          </Link>

          {/* Divider */}
          <hr className="my-2 border-neutral-border" />

          {showLoginAction ? (
            <button
              type="button"
              onClick={handleLogin}
              className="w-full px-6 py-3 text-left text-sm hover:bg-neutral-light transition-colors"
            >
              Влез
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full px-6 py-3 text-left text-sm text-error hover:bg-error-light transition-colors"
            >
              Излез
            </button>
          )}
        </div>
      </div>
    </>
  );
}
