"use client";

import { useReducer, useEffect, useCallback, useMemo } from "react";
import { User } from "firebase/auth";

/**
 * Onboarding flow states
 *
 * See docs/features/onboarding-flow.md for state machine diagram
 */
export type OnboardingState =
  | "loading"
  | "notificationPrompt"
  | "blocked"
  | "loginPrompt"
  | "zoneCreation"
  | "complete"
  | "idle";

/**
 * Actions that can be dispatched to the state machine
 */
export type OnboardingAction =
  | { type: "LOADED"; payload: OnboardingContext }
  | {
      type: "PERMISSION_RESULT";
      payload: {
        permission: NotificationPermission;
        context: OnboardingContext;
      };
    }
  | { type: "DISMISS" }
  | { type: "RESTART"; payload: OnboardingContext }
  | { type: "RE_EVALUATE"; payload: OnboardingContext };

/**
 * Context used to determine state transitions
 */
export interface OnboardingContext {
  /** Browser notification permission status, undefined if API not available */
  permission: NotificationPermission | undefined;
  /** Whether a non-anonymous user is signed in. Firebase anonymous users are treated as unauthenticated. */
  isLoggedIn: boolean;
  /** Number of interest zones the user has */
  zonesCount: number;
  /** Whether user has at least one push notification subscription */
  hasSubscriptions: boolean;
  /** Whether guest mode is currently available */
  guestAvailable?: boolean;
  /** Whether this is a restart (user clicked button) vs initial load */
  isRestart?: boolean;
  /** Whether the user has already seen the zero-zones creation prompt */
  hasSeenZoneCreationPrompt?: boolean;
}

/**
 * Internal state for the reducer
 */
interface ReducerState {
  state: OnboardingState;
  /** Cache the last known permission for RESTART logic */
  lastPermission: NotificationPermission | undefined;
  /** Track if user explicitly dismissed a prompt to prevent RE_EVALUATE from overriding idle state */
  isDismissed: boolean;
}

// ============================================================================
// State Computation Helpers
// ============================================================================

/**
 * Determine state for unauthenticated users.
 *
 * Flow: idle (initial) → notificationPrompt (on restart) → blocked/loginPrompt
 */
function computeUnauthenticatedState(
  permission: NotificationPermission | undefined,
  isRestart: boolean,
  guestAvailable = true,
): OnboardingState {
  // Initial load: always show idle state for clean UI
  if (!isRestart) {
    return "idle";
  }

  // User clicked button (RESTART) - now check permission
  // No Notification API or permission already granted → continue with zone creation
  if (permission === undefined || permission === "granted") {
    return guestAvailable ? "zoneCreation" : "loginPrompt";
  }

  // Permission denied → explain blocked notifications
  if (permission === "denied") {
    return "blocked";
  }

  // Permission is "default" - show notification prompt
  return "notificationPrompt";
}

/**
 * Determine state for authenticated users.
 *
 * Flow: zoneCreation → notificationPrompt/blocked → complete
 */
function computeAuthenticatedState(
  zonesCount: number,
  permission: NotificationPermission | undefined,
  hasSeenZoneCreationPrompt = false,
): OnboardingState {
  // No zones yet → prompt to create one (unless already seen)
  if (zonesCount === 0) {
    return hasSeenZoneCreationPrompt ? "complete" : "zoneCreation";
  }

  // Has zones - check notification permission
  if (permission === "default") {
    return "notificationPrompt";
  }

  if (permission === "denied") {
    return "blocked";
  }

  // Permission granted or API unavailable → fully onboarded
  return "complete";
}

/**
 * Compute the appropriate state based on context.
 *
 * Design Decision: First-time visitors (permission="default", not logged in)
 * land in `idle` state to keep the UI clean. The onboarding flow only starts
 * when the user clicks the AddInterestButton (RESTART action with isRestart=true).
 */
export function computeStateFromContext(
  context: OnboardingContext,
): OnboardingState {
  const { permission, isLoggedIn, zonesCount, isRestart = false } = context;

  return isLoggedIn
    ? computeAuthenticatedState(
        zonesCount,
        permission,
        context.hasSeenZoneCreationPrompt,
      )
    : computeUnauthenticatedState(
        permission,
        isRestart,
        context.guestAvailable,
      );
}

// ============================================================================
// Reducer Action Handlers
// ============================================================================

/** States that can be dismissed to idle */
const DISMISSIBLE_STATES: ReadonlySet<OnboardingState> = new Set([
  "notificationPrompt",
  "loginPrompt",
  "zoneCreation",
]);

/**
 * State progression order for RE_EVALUATE.
 * Higher number = further along in onboarding.
 * idle = -1 (special case, never progressed into via RE_EVALUATE)
 *
 * Note: notificationPrompt and blocked share order 3 with zoneCreation
 * because authenticated users with zones can reach these states.
 */
const STATE_ORDER: Record<OnboardingState, number> = {
  idle: -1,
  loading: 0,
  loginPrompt: 1,
  zoneCreation: 2,
  notificationPrompt: 3,
  blocked: 3,
  complete: 4,
};

/** Check if new state represents forward progress */
function isProgressingForward(
  currentState: OnboardingState,
  newState: OnboardingState,
): boolean {
  return STATE_ORDER[newState] >= STATE_ORDER[currentState];
}

function handleLoaded(action: { payload: OnboardingContext }): ReducerState {
  return {
    state: computeStateFromContext(action.payload),
    lastPermission: action.payload.permission,
    isDismissed: false,
  };
}

function handlePermissionResult(
  state: ReducerState,
  permission: NotificationPermission,
  context: OnboardingContext,
): ReducerState {
  if (state.state !== "notificationPrompt") return state;

  // Determine next state based on permission and user auth status
  let newState: OnboardingState;

  if (permission === "denied") {
    newState = "blocked";
  } else if (context.zonesCount > 0) {
    // User with zones who granted permission → complete
    newState = "complete";
  } else {
    // Continue to zone creation only when guest session is available
    newState =
      context.guestAvailable === false ? "loginPrompt" : "zoneCreation";
  }

  return { ...state, state: newState, lastPermission: permission };
}

function handleDismiss(state: ReducerState): ReducerState {
  if (!DISMISSIBLE_STATES.has(state.state)) return state;
  return { ...state, state: "idle", isDismissed: true };
}

function handleRestart(
  state: ReducerState,
  context: OnboardingContext,
): ReducerState {
  if (state.state !== "idle") return state;

  const newState = computeStateFromContext({ ...context, isRestart: true });
  return { ...state, state: newState, isDismissed: false };
}

function handleReEvaluate(
  state: ReducerState,
  context: OnboardingContext,
): ReducerState {
  // Allow progression out of idle when context meaningfully changes
  if (state.state === "idle") {
    // If user explicitly dismissed, keep them in idle unless RESTART is used
    if (state.isDismissed) {
      return { ...state, lastPermission: context.permission };
    }

    const newState = computeStateFromContext(context);

    // If login or other inputs advance the flow, move forward
    if (newState !== "idle") {
      return {
        state: newState,
        lastPermission: context.permission,
        isDismissed: false,
      };
    }

    // Otherwise remain idle but keep permission cache fresh
    return { ...state, lastPermission: context.permission };
  }

  const newState = computeStateFromContext(context);

  // Only allow forward progression
  if (isProgressingForward(state.state, newState)) {
    return {
      state: newState,
      lastPermission: context.permission,
      isDismissed: false,
    };
  }

  // Just update permission cache
  return { ...state, lastPermission: context.permission };
}

// ============================================================================
// Reducer
// ============================================================================

/**
 * Pure reducer for onboarding state machine
 */
export function onboardingReducer(
  state: ReducerState,
  action: OnboardingAction,
): ReducerState {
  switch (action.type) {
    case "LOADED":
      return handleLoaded(action);

    case "PERMISSION_RESULT":
      return handlePermissionResult(
        state,
        action.payload.permission,
        action.payload.context,
      );

    case "DISMISS":
      return handleDismiss(state);

    case "RESTART":
      return handleRestart(state, action.payload);

    case "RE_EVALUATE":
      return handleReEvaluate(state, action.payload);

    default:
      return state;
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Initial state for the reducer
 */
const initialState: ReducerState = {
  state: "loading",
  lastPermission: undefined,
  isDismissed: false,
};

/**
 * Hook inputs
 */
export interface UseOnboardingFlowInput {
  user: User | null;
  interests: readonly { id?: string }[];
  subscriptionsLoaded: boolean;
  hasSubscriptions: boolean;
  guestAvailable?: boolean;
}

/**
 * Hook return type
 */
export interface UseOnboardingFlowReturn {
  /** Current onboarding state */
  state: OnboardingState;
  /** Dispatch an action to the state machine */
  dispatch: (action: OnboardingAction) => void;
  /** Handle permission result from NotificationPrompt */
  handlePermissionResult: (permission: NotificationPermission) => void;
  /** Handle dismiss from any prompt */
  handleDismiss: () => void;
  /** Handle restart (from AddInterestButton in idle state) */
  handleRestart: () => void;
}

/**
 * Get current notification permission, or undefined if API not available
 */
function getNotificationPermission(): NotificationPermission | undefined {
  if (typeof globalThis !== "undefined" && "Notification" in globalThis) {
    return Notification.permission;
  }
  return undefined;
}

const ZONE_CREATION_SEEN_KEY = "obo_seen_zone_prompt";

/**
 * Hook to manage onboarding flow state machine
 *
 * @example
 * ```tsx
 * const { state, handlePermissionResult, handleDismiss } = useOnboardingFlow({
 *   user,
 *   interests,
 *   subscriptionsLoaded,
 *   hasSubscriptions,
 * });
 *
 * if (state === 'notificationPrompt') {
 *   return <NotificationPrompt onPermissionResult={handlePermissionResult} onDismiss={handleDismiss} />;
 * }
 * ```
 */
export function useOnboardingFlow(
  input: UseOnboardingFlowInput,
): UseOnboardingFlowReturn {
  const {
    user,
    interests,
    subscriptionsLoaded,
    hasSubscriptions,
    guestAvailable = true,
  } = input;

  const [reducerState, dispatch] = useReducer(onboardingReducer, initialState);

  // Build current context
  const context = useMemo((): OnboardingContext => {
    let hasSeenZoneCreationPrompt = false;
    try {
      hasSeenZoneCreationPrompt =
        typeof localStorage !== "undefined"
          ? localStorage.getItem(ZONE_CREATION_SEEN_KEY) === "true"
          : false;
    } catch {
      // Ignore storage errors (Safari private browsing, blocked storage, etc.)
    }
    return {
      permission: getNotificationPermission(),
      // Anonymous Firebase users are treated as unauthenticated so they land in
      // idle state like a first-time visitor rather than triggering the zone-creation prompt.
      isLoggedIn: user !== null && !user.isAnonymous,
      zonesCount: interests.length,
      hasSubscriptions,
      guestAvailable,
      hasSeenZoneCreationPrompt,
    };
  }, [user, interests.length, hasSubscriptions, guestAvailable]);

  // Mark prompt as seen when state enters zoneCreation
  useEffect(() => {
    if (reducerState.state === "zoneCreation") {
      try {
        localStorage.setItem(ZONE_CREATION_SEEN_KEY, "true");
      } catch {
        // Ignore storage errors (private browsing, quota exceeded, etc.)
      }
    }
  }, [reducerState.state]);

  // Initial load - dispatch LOADED once subscriptions are checked
  useEffect(() => {
    if (reducerState.state === "loading" && subscriptionsLoaded) {
      dispatch({ type: "LOADED", payload: context });
    }
  }, [reducerState.state, subscriptionsLoaded, context]);

  // Re-evaluate when external state changes (user logs in, zones added, etc.)
  useEffect(() => {
    if (reducerState.state !== "loading" && subscriptionsLoaded) {
      dispatch({ type: "RE_EVALUATE", payload: context });
    }
  }, [context, subscriptionsLoaded, reducerState.state]);

  // Callback handlers
  const handlePermissionResult = useCallback(
    (permission: NotificationPermission) => {
      // Include the new permission value in context to ensure consistency
      const freshContext = {
        ...context,
        permission,
      };
      dispatch({
        type: "PERMISSION_RESULT",
        payload: { permission, context: freshContext },
      });
    },
    [context],
  );

  const handleDismiss = useCallback(() => {
    dispatch({ type: "DISMISS" });
  }, []);

  const handleRestart = useCallback(() => {
    // Read fresh permission to avoid stale memoized context
    // (permission can change after PERMISSION_RESULT but context won't update)
    const freshContext = {
      ...context,
      permission: getNotificationPermission(),
    };
    dispatch({ type: "RESTART", payload: freshContext });
  }, [context]);

  return {
    state: reducerState.state,
    dispatch,
    handlePermissionResult,
    handleDismiss,
    handleRestart,
  };
}
