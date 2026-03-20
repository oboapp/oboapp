"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useIsMobile } from "@/lib/hooks/useMediaQuery";
import { fetchUnreadNotificationCount } from "@/lib/notification-history";
import NotificationDropdown from "./NotificationDropdown";
import UnreadIndicator from "./UnreadIndicator";

// Poll for unread count every 60 seconds
const UNREAD_COUNT_POLL_INTERVAL_MS = 60000;

export default function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);

  const getUnreadCount = useCallback(async (): Promise<number | null> => {
    if (!user) return null;

    try {
      return await fetchUnreadNotificationCount(user);
    } catch (error) {
      console.error("Error fetching unread count:", error);
      return null;
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void getUnreadCount().then((count) => {
      if (typeof count === "number") {
        setUnreadCount(count);
      }
    });

    // Listen for unread count changes from other parts of the app
    const handleCountChange = (event: Event) => {
      if ("detail" in event && typeof event.detail === "object" && event.detail !== null) {
        const detail = event.detail;
        if ("count" in detail && typeof detail.count === "number") {
          setUnreadCount(detail.count);
        }
      }
    };

    window.addEventListener(
      "notifications:unread-count-changed",
      handleCountChange,
    );

    // Poll for updates every 60 seconds
    const interval = setInterval(() => {
      void getUnreadCount().then((count) => {
        if (typeof count === "number") {
          setUnreadCount(count);
        }
      });
    }, UNREAD_COUNT_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      window.removeEventListener(
        "notifications:unread-count-changed",
        handleCountChange,
      );
    };
  }, [user, getUnreadCount]);

  const handleToggle = () => {
    // On mobile (screen width < 640px), navigate to notifications page instead of showing dropdown
    if (isMobile) {
      router.push("/notifications");
    } else {
      setIsOpen(!isOpen);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleCountUpdate = (newCount: number) => {
    setUnreadCount(newCount);
  };

  if (!user) {
    return null;
  }

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={handleToggle}
        className="relative flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
      >
        <Bell className="w-6 h-6 text-white" />
        {unreadCount > 0 && <UnreadIndicator />}
      </button>

      {!isMobile && isOpen && (
        <NotificationDropdown
          isOpen={isOpen}
          onClose={handleClose}
          onCountUpdate={handleCountUpdate}
          anchorRef={bellRef}
        />
      )}
    </div>
  );
}
