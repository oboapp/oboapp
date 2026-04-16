---
name: onboarding-flow
description: Reminders and checks when working on onboarding/on boarding/on-boarding features
agent-name: copilot
version: 1.0.0
keywords:
  - onboarding
  - authentication
  - notifications
  - idle-state
  - geolocation
---

# Onboarding Flow Guardrails Skill

Use this skill whenever you touch onboarding/on boarding/on-boarding behavior, auth flow entry points, or notification permission prompts.

## Must-Remember Behaviors

1. **Idle re-evaluates on auth change**: RE_EVALUATE now runs even from `idle`; if context progresses (e.g., user logs in, zones exist), state must advance immediately (no refresh). Tests expect this.
2. **Header login**: Logging in from the header must trigger RE_EVALUATE and advance the flow (idle → zoneCreation/complete). Keep analytics source `header` distinct from onboarding prompt.
3. **Logout prompt avoidance**: Sign-out must not trigger `Notification.requestPermission`. Skip token cleanup when permission ≠ granted; avoid prompting on logout.
4. **Permission flow order**: Never call `Notification.requestPermission` unless the user action warrants it (e.g., NotificationPrompt accept). Respect blocked/denied and don’t auto-prompt.
5. **Docs parity**: Update `docs/features/onboarding-flow.md` when altering onboarding progression, idle behavior, or logout/notification prompt handling.

## Quick Checks Before Shipping

- State machine: RE_EVALUATE allowed from `idle`; forward-only progression; no regressions when unauthenticated.
- Header login: confirm immediate UI advance without refresh; avatar + onboarding state stay in sync.
- Logout: verify no browser notification prompt appears; best-effort token cleanup only when permission is granted.
- Tests: update onboarding reducer tests if state progression rules change.
- Analytics: preserve distinct event sources (`header` vs `prompt`).

## Files to Read First

- `web/lib/hooks/useOnboardingFlow.ts`
- `web/lib/hooks/useOnboardingFlow.test.ts`
- `web/components/onboarding/OnboardingPrompt.tsx`
- `web/components/Header.tsx` (login entry)
- `web/lib/notification-service.ts` (logout/token handling)
- `docs/features/onboarding-flow.md`

## Common Pitfalls

- Forgetting to advance from `idle` on auth change → onboarding appears stale after header login.
- Triggering `Notification.requestPermission` during logout → browser prompt pops up.
- Not updating docs/tests when changing state machine rules.

## Done Checklist

- [ ] Idle progression verified (auth change advances flow)
- [ ] Logout does not prompt for notifications
- [ ] Tests adjusted/added
- [ ] Docs updated (`docs/features/onboarding-flow.md`)
- [ ] Analytics source tags intact
