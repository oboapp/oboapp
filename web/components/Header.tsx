"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { zIndex } from "@/lib/colors";
import { APP_NAME } from "@/lib/pwa-metadata";
import UserMenu from "@/components/UserMenu";
import NotificationBell from "@/components/NotificationBell";
import UserSilhouetteIcon from "@/components/icons/UserSilhouetteIcon";

const USER_MENU_ID = "header-user-menu";

export default function Header() {
  const { user } = useAuth();
  const [logoError, setLogoError] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const handleUserMenuClose = () => {
    setShowUserMenu(false);
    requestAnimationFrame(() => {
      userMenuTriggerRef.current?.focus();
    });
  };

  return (
    <>
      {/* Top Header - Dark Blue */}
      <header
        className={`bg-header-bg text-white relative ${zIndex.nav} shadow-md`}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* Main Header with Logo */}
          <div className="flex items-center justify-between py-2 sm:py-1">
            {/* Left side - Logo and Title */}
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Logo - overlapping content below */}
              <Link
                href="/"
                className="flex-shrink-0 relative sm:-mb-10 md:-mb-12 cursor-pointer hover:opacity-90 transition-opacity"
              >
                {logoError ? null : (
                  <div
                    className={`inline-block bg-white rounded-lg p-1 shadow-md relative ${zIndex.overlay}`}
                  >
                    <Image
                      src="/logo.png"
                      alt={APP_NAME}
                      width={96}
                      height={96}
                      className="h-9 sm:h-16 md:h-20 w-auto object-contain"
                      onError={() => setLogoError(true)}
                      priority
                    />
                  </div>
                )}
              </Link>
              <div>
                <h1 className="text-sm sm:text-base md:text-lg font-bold" translate="no">
                  {APP_NAME}
                </h1>
              </div>
            </div>

            {/* Right side - User Info */}
            <div className="flex items-center gap-4">
              {user && <NotificationBell />}
              <button
                ref={userMenuTriggerRef}
                type="button"
                onClick={() => setShowUserMenu((current) => !current)}
                className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-full"
                aria-label="Профилно меню"
                aria-haspopup="dialog"
                aria-expanded={showUserMenu}
                aria-controls={USER_MENU_ID}
              >
                {user?.photoURL ? (
                  <Image
                    src={user.photoURL}
                    alt={user.displayName || "Потребител"}
                    width={32}
                    height={32}
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/20 text-white">
                    <UserSilhouetteIcon className="w-5 h-5" />
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Bar - Light Blue */}
      <nav className="bg-nav-bg hidden sm:block">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex gap-6 py-3 items-center">
            {/* Navigation items can be added here */}
          </div>
        </div>
      </nav>

      {/* User Menu */}
      <UserMenu
        id={USER_MENU_ID}
        isOpen={showUserMenu}
        onClose={handleUserMenuClose}
      />
    </>
  );
}
