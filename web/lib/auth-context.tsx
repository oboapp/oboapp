"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInAnonymously,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth } from "./firebase";
import { trackEvent } from "./analytics";
import {
  PENDING_GUEST_UPGRADE_UID_KEY,
  PENDING_GUEST_UPGRADE_TOKEN_KEY,
} from "./auth-upgrade";

/**
 * Checks if a Firebase Auth error represents user-initiated cancellation
 * (e.g., closing the popup or cancelling the auth request).
 * Returns true if the error should be ignored (not a real error).
 */
function isUserCancellationError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (
      error.code === "auth/popup-closed-by-user" ||
      error.code === "auth/cancelled-popup-request"
    );
  }
  return false;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  guestAuthUnavailable: boolean;
  signInWithGoogle: () => Promise<void>;
  reauthenticateWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestAuthUnavailable, setGuestAuthUnavailable] = useState(false);

  useEffect(() => {
    // MSW Mode: Skip Firebase auth subscription and use mock user
    // Double-gated so mock auth can never activate in production
    if (
      process.env.NEXT_PUBLIC_USE_MSW === "true" &&
      process.env.NODE_ENV === "development"
    ) {
      // Dynamic import to satisfy ESLint no-require-imports rule
      import("@/__mocks__/firebase-auth")
        .then(({ MOCK_USER }) => {
          setUser(MOCK_USER);
          setLoading(false);
        })
        .catch((error) => {
          console.error("Failed to load MSW mock Firebase auth module:", error);
          setUser(null);
          setLoading(false);
        });
      return () => {};
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setGuestAuthUnavailable(false);
        setLoading(false);
        return;
      }

      setUser(null);
      setLoading(true);

      try {
        await signInAnonymously(auth);
        trackEvent({ name: "guest_started", params: {} });
      } catch (error) {
        console.error("Error signing in anonymously:", error);
        setGuestAuthUnavailable(true);
        setUser(null);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const guestUserBeforeUpgrade = user?.isAnonymous ? user : null;

    if (
      guestUserBeforeUpgrade &&
      typeof globalThis.sessionStorage !== "undefined"
    ) {
      try {
        const guestIdToken = await guestUserBeforeUpgrade.getIdToken();
        globalThis.sessionStorage.setItem(
          PENDING_GUEST_UPGRADE_UID_KEY,
          guestUserBeforeUpgrade.uid,
        );
        globalThis.sessionStorage.setItem(
          PENDING_GUEST_UPGRADE_TOKEN_KEY,
          guestIdToken,
        );
      } catch (error: unknown) {
        globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_UID_KEY);
        globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_TOKEN_KEY);
        console.error(
          "Failed to store pending guest upgrade metadata, continuing with Google sign-in:",
          error,
        );
      }
    }

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: unknown) {
      // User closing the popup is intentional, not an error
      if (isUserCancellationError(error)) {
        if (typeof globalThis.sessionStorage !== "undefined") {
          globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_UID_KEY);
          globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_TOKEN_KEY);
        }
        return;
      }
      if (typeof globalThis.sessionStorage !== "undefined") {
        globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_UID_KEY);
        globalThis.sessionStorage.removeItem(PENDING_GUEST_UPGRADE_TOKEN_KEY);
      }
      console.error("Error signing in with Google:", error);
      throw error;
    }
  }, [user]);

  const reauthenticateWithGoogle = useCallback(async () => {
    if (!user) {
      throw new Error("No user to reauthenticate");
    }
    try {
      const provider = new GoogleAuthProvider();
      const { reauthenticateWithPopup } = await import("firebase/auth");
      await reauthenticateWithPopup(user, provider);
    } catch (error: unknown) {
      // User closing the popup is intentional, not an error
      if (isUserCancellationError(error)) {
        return;
      }
      console.error("Error reauthenticating with Google:", error);
      throw error;
    }
  }, [user]);

  const signOut = useCallback(async () => {
    try {
      // Unsubscribe from push notifications before signing out
      if (user) {
        try {
          const idToken = await user.getIdToken();
          const { unsubscribeOnSignOut } =
            await import("./notification-service");
          await unsubscribeOnSignOut(user.uid, idToken);
        } catch (notifError) {
          // Don't block sign-out if notification cleanup fails
          console.error("Error cleaning up notifications:", notifError);
        }
      }

      await firebaseSignOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
      throw error;
    }
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      guestAuthUnavailable,
      signInWithGoogle,
      reauthenticateWithGoogle,
      signOut,
    }),
    [
      user,
      loading,
      guestAuthUnavailable,
      signInWithGoogle,
      reauthenticateWithGoogle,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
