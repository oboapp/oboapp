import { describe, it, expect, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import {
  onboardingReducer,
  computeStateFromContext,
  useOnboardingFlow,
  OnboardingContext,
  OnboardingAction,
} from "./useOnboardingFlow";

describe("computeStateFromContext", () => {
  describe("when user is not logged in", () => {
    it("returns idle on initial load when permission is default", () => {
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("idle");
    });

    it("returns notificationPrompt on restart when permission is default", () => {
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
        isRestart: true,
      };
      expect(computeStateFromContext(context)).toBe("notificationPrompt");
    });

    it("returns idle on initial load when permission is granted", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("idle");
    });

    it("returns zoneCreation on restart when permission is granted", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
        isRestart: true,
      };
      expect(computeStateFromContext(context)).toBe("zoneCreation");
    });

    it("returns loginPrompt on restart when permission is granted and guest is unavailable", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
        guestAvailable: false,
        isRestart: true,
      };
      expect(computeStateFromContext(context)).toBe("loginPrompt");
    });

    it("returns idle on initial load when permission is denied", () => {
      const context: OnboardingContext = {
        permission: "denied",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("idle");
    });

    it("returns blocked on restart when permission is denied", () => {
      const context: OnboardingContext = {
        permission: "denied",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
        isRestart: true,
      };
      expect(computeStateFromContext(context)).toBe("blocked");
    });

    it("returns idle on initial load when Notification API is unavailable", () => {
      const context: OnboardingContext = {
        permission: undefined,
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("idle");
    });

    it("returns zoneCreation on restart when Notification API is unavailable", () => {
      const context: OnboardingContext = {
        permission: undefined,
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
        isRestart: true,
      };
      expect(computeStateFromContext(context)).toBe("zoneCreation");
    });

    it("returns loginPrompt on restart when Notification API is unavailable and guest is unavailable", () => {
      const context: OnboardingContext = {
        permission: undefined,
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
        guestAvailable: false,
        isRestart: true,
      };
      expect(computeStateFromContext(context)).toBe("loginPrompt");
    });
  });

  // Note: anonymous Firebase users are mapped to isLoggedIn=false in useOnboardingFlow's useMemo
  // (user !== null && !user.isAnonymous). The hook-level derivation is tested in the
  // "useOnboardingFlow hook" describe block below.

  describe("when user is logged in", () => {
    it("returns zoneCreation when user has no zones", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("zoneCreation");
    });

    it("returns complete when user has no zones but has already seen the zone creation prompt", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 0,
        hasSubscriptions: false,
        hasSeenZoneCreationPrompt: true,
      };
      expect(computeStateFromContext(context)).toBe("complete");
    });

    it("returns zoneCreation when user has no zones and hasSeenZoneCreationPrompt is false", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 0,
        hasSubscriptions: false,
        hasSeenZoneCreationPrompt: false,
      };
      expect(computeStateFromContext(context)).toBe("zoneCreation");
    });

    it("returns notificationPrompt when user has zones but permission is default", () => {
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: true,
        zonesCount: 2,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("notificationPrompt");
    });

    it("returns complete when user has zones and permission is granted", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 2,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("complete");
    });

    it("returns complete when user has zones and subscriptions", () => {
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 2,
        hasSubscriptions: true,
      };
      expect(computeStateFromContext(context)).toBe("complete");
    });

    it("returns blocked when permission is denied and user has zones", () => {
      const context: OnboardingContext = {
        permission: "denied",
        isLoggedIn: true,
        zonesCount: 2,
        hasSubscriptions: false,
      };
      expect(computeStateFromContext(context)).toBe("blocked");
    });
  });
});

describe("onboardingReducer", () => {
  const createInitialState = (
    state: string,
    lastPermission?: NotificationPermission,
    isDismissed = false,
  ) => ({
    state: state as ReturnType<typeof computeStateFromContext>,
    lastPermission,
    isDismissed,
  });

  describe("LOADED action", () => {
    it("transitions from loading to idle for unauthenticated user with default permission", () => {
      const initialState = createInitialState("loading");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = { type: "LOADED", payload: context };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("idle");
      expect(result.lastPermission).toBe("default");
    });

    it("transitions to idle when permission already granted (unauthenticated)", () => {
      const initialState = createInitialState("loading");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = { type: "LOADED", payload: context };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("idle");
    });

    it("transitions to complete when user is fully onboarded", () => {
      const initialState = createInitialState("loading");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 3,
        hasSubscriptions: true,
      };
      const action: OnboardingAction = { type: "LOADED", payload: context };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
    });

    it("initializes isDismissed to false", () => {
      const initialState = createInitialState("loading");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = { type: "LOADED", payload: context };

      const result = onboardingReducer(initialState, action);

      expect(result.isDismissed).toBe(false);
    });
  });

  describe("PERMISSION_RESULT action", () => {
    it("transitions to blocked when permission denied", () => {
      const initialState = createInitialState("notificationPrompt", "default");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "PERMISSION_RESULT",
        payload: { permission: "denied", context },
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("blocked");
      expect(result.lastPermission).toBe("denied");
    });

    it("transitions to zoneCreation when permission granted (guest flow)", () => {
      const initialState = createInitialState("notificationPrompt", "default");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "PERMISSION_RESULT",
        payload: { permission: "granted", context },
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("zoneCreation");
      expect(result.lastPermission).toBe("granted");
    });

    it("transitions to loginPrompt when permission granted and guest is unavailable", () => {
      const initialState = createInitialState("notificationPrompt", "default");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
        guestAvailable: false,
      };
      const action: OnboardingAction = {
        type: "PERMISSION_RESULT",
        payload: { permission: "granted", context },
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("loginPrompt");
      expect(result.lastPermission).toBe("granted");
    });

    it("transitions to complete when permission granted (authenticated with zones)", () => {
      const initialState = createInitialState("notificationPrompt", "default");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: true,
        zonesCount: 2,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "PERMISSION_RESULT",
        payload: { permission: "granted", context },
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
      expect(result.lastPermission).toBe("granted");
    });

    it("ignores action from non-notificationPrompt states", () => {
      const initialState = createInitialState("loginPrompt", "default");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "PERMISSION_RESULT",
        payload: { permission: "granted", context },
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("loginPrompt");
    });
  });

  describe("DISMISS action", () => {
    it.each(["notificationPrompt", "loginPrompt", "zoneCreation"])(
      "transitions from %s to idle",
      (fromState) => {
        const initialState = createInitialState(fromState);
        const action: OnboardingAction = { type: "DISMISS" };

        const result = onboardingReducer(initialState, action);

        expect(result.state).toBe("idle");
      },
    );

    it("ignores action from blocked state (blocked is not dismissible)", () => {
      const initialState = createInitialState("blocked");
      const action: OnboardingAction = { type: "DISMISS" };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("blocked");
    });

    it("ignores action from complete state", () => {
      const initialState = createInitialState("complete");
      const action: OnboardingAction = { type: "DISMISS" };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
    });

    it("ignores action from idle state", () => {
      const initialState = createInitialState("idle");
      const action: OnboardingAction = { type: "DISMISS" };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("idle");
    });

    it.each(["notificationPrompt", "loginPrompt", "zoneCreation"])(
      "sets isDismissed flag when dismissing %s",
      (fromState) => {
        const initialState = createInitialState(fromState);
        const action: OnboardingAction = { type: "DISMISS" };

        const result = onboardingReducer(initialState, action);

        expect(result.state).toBe("idle");
        expect(result.isDismissed).toBe(true);
      },
    );
  });

  describe("RESTART action", () => {
    it("re-evaluates from idle to notificationPrompt", () => {
      const initialState = createInitialState("idle");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      // RESTART uses payload as context
      const action = { type: "RESTART", payload: context } as OnboardingAction;

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("notificationPrompt");
    });

    it("re-evaluates from idle to zoneCreation when permission granted", () => {
      const initialState = createInitialState("idle", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action = { type: "RESTART", payload: context } as OnboardingAction;

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("zoneCreation");
    });

    it("re-evaluates from idle to complete when fully onboarded", () => {
      const initialState = createInitialState("idle", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 2,
        hasSubscriptions: true,
      };
      const action = { type: "RESTART", payload: context } as OnboardingAction;

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
    });

    it("clears isDismissed flag when restarting from dismissed idle state", () => {
      const initialState = createInitialState("idle", "granted", true);
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action = { type: "RESTART", payload: context } as OnboardingAction;

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("zoneCreation");
      expect(result.isDismissed).toBe(false);
    });

    it("ignores action from non-idle states", () => {
      const initialState = createInitialState("notificationPrompt");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 2,
        hasSubscriptions: true,
      };
      const action = { type: "RESTART", payload: context } as OnboardingAction;

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("notificationPrompt");
    });
  });

  describe("RE_EVALUATE action", () => {
    it("progresses from loginPrompt to zoneCreation when user logs in", () => {
      const initialState = createInitialState("loginPrompt", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("zoneCreation");
    });

    it("progresses from zoneCreation to notificationPrompt when zone added and permission is default", () => {
      const initialState = createInitialState("zoneCreation", "default");
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: true,
        zonesCount: 1,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("notificationPrompt");
    });

    it("progresses from zoneCreation to complete when zone added and permission is granted", () => {
      const initialState = createInitialState("zoneCreation", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 1,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
    });

    it("progresses from notificationPrompt to complete via RE_EVALUATE when granted", () => {
      const initialState = createInitialState("notificationPrompt", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 1,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
    });

    it("progresses from idle when context moves forward", () => {
      const initialState = createInitialState("idle", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 1,
        hasSubscriptions: true,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
      expect(result.lastPermission).toBe("granted");
    });

    it("does not regress state", () => {
      const initialState = createInitialState("zoneCreation", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false, // Would normally go back to loginPrompt
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      // Should not regress to loginPrompt
      expect(result.state).toBe("zoneCreation");
    });

    it("allows progression to complete from blocked state", () => {
      const initialState = createInitialState("blocked", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 5,
        hasSubscriptions: true,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("complete");
    });

    it("progresses to blocked when permission is denied", () => {
      const initialState = createInitialState("zoneCreation", "denied");
      const context: OnboardingContext = {
        permission: "denied",
        isLoggedIn: true,
        zonesCount: 1,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("blocked");
    });

    it("keeps state as idle when user dismissed loginPrompt (isDismissed=true)", () => {
      const initialState = createInitialState("idle", "granted", true);
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("idle");
      expect(result.isDismissed).toBe(true);
    });

    it("keeps state as idle when user dismissed notificationPrompt (isDismissed=true)", () => {
      const initialState = createInitialState("idle", "default", true);
      const context: OnboardingContext = {
        permission: "default",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("idle");
      expect(result.isDismissed).toBe(true);
    });

    it("keeps state as idle when user dismissed zoneCreation (isDismissed=true)", () => {
      const initialState = createInitialState("idle", "granted", true);
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: true,
        zonesCount: 0,
        hasSubscriptions: false,
      };
      const action: OnboardingAction = {
        type: "RE_EVALUATE",
        payload: context,
      };

      const result = onboardingReducer(initialState, action);

      expect(result.state).toBe("idle");
      expect(result.isDismissed).toBe(true);
    });
  });

  describe("Integration: dismiss and re-evaluate flow", () => {
    it("should keep user in idle state after dismissing loginPrompt, even when RE_EVALUATE runs", () => {
      // Scenario from issue #92:
      // 1. User sees LoginPrompt and clicks "По-късно"
      // 2. DISMISS action → state transitions to idle
      // 3. RE_EVALUATE runs (triggered by state change in useEffect)
      // 4. User should STAY in idle state (not go back to loginPrompt)

      // Start in loginPrompt state (unauthenticated user with granted permission)
      const loginPromptState = createInitialState("loginPrompt", "granted");
      const context: OnboardingContext = {
        permission: "granted",
        isLoggedIn: false,
        zonesCount: 0,
        hasSubscriptions: false,
      };

      // User clicks "По-късно" (Later) button
      const dismissedState = onboardingReducer(loginPromptState, {
        type: "DISMISS",
      });
      expect(dismissedState.state).toBe("idle");
      expect(dismissedState.isDismissed).toBe(true);

      // RE_EVALUATE runs (as it does in useEffect)
      const reEvaluatedState = onboardingReducer(dismissedState, {
        type: "RE_EVALUATE",
        payload: context,
      });

      // User should STAY in idle state (this is the fix!)
      expect(reEvaluatedState.state).toBe("idle");
      expect(reEvaluatedState.isDismissed).toBe(true);

      // But RESTART should still allow the flow to restart
      const restartedState = onboardingReducer(reEvaluatedState, {
        type: "RESTART",
        payload: context,
      });
      expect(restartedState.state).toBe("zoneCreation");
      expect(restartedState.isDismissed).toBe(false);
    });
  });
});

describe("useOnboardingFlow hook", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("treats an anonymous Firebase user as unauthenticated and lands in idle", async () => {
    const anonymousUser = {
      uid: "anon-123",
      isAnonymous: true,
      email: null,
      displayName: null,
      photoURL: null,
    } as unknown as User;

    const { result } = renderHook(() =>
      useOnboardingFlow({
        user: anonymousUser,
        interests: [],
        subscriptionsLoaded: true,
        hasSubscriptions: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe("idle");
    });
  });

  it("treats a signed-in user with no zones as zoneCreation", async () => {
    // computeAuthenticatedState short-circuits to "zoneCreation" when zonesCount===0,
    // regardless of Notification.permission — no permission mock needed.
    const signedInUser = {
      uid: "user-456",
      isAnonymous: false,
      email: "user@example.com",
      displayName: "Test User",
      photoURL: null,
    } as unknown as User;

    const { result } = renderHook(() =>
      useOnboardingFlow({
        user: signedInUser,
        interests: [],
        subscriptionsLoaded: true,
        hasSubscriptions: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.state).toBe("zoneCreation");
    });
  });
});
