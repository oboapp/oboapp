---
name: tailwind-theme
description: Theme colors, accessible controls, touch feedback, and motion conventions for the web package
version: 1.0.0
keywords:
  - tailwind
  - theme
  - colors
  - button
  - styling
  - css
  - design
  - variant
  - accessibility
  - touch
  - motion
---

# Tailwind Theme System Skill

**IMPORTANT**: Using Tailwind Theme skill! Never hardcode colors — always use theme tokens.

## Architecture

- **Single source of truth:** `web/lib/colors.ts` defines the color palette.
- **CSS variables:** `web/app/globals.css` implements the theme via Tailwind v4 @theme.
- **Component utilities:** `web/lib/theme.ts` provides button styles and helpers.

## Color Categories

| Token prefix | Purpose |
| --- | --- |
| `primary` / `primary-hover` | Primary actions |
| `destructive` / `destructive-hover` | Destructive actions |
| `neutral` / `neutral-*` | Borders, backgrounds, text, disabled states |
| `error` / `error-*` | Validation errors, error messages |
| `warning` / `warning-*` | Warnings, caution states |
| `success` / `success-*` | Success states, confirmations |
| `info` / `info-*` | Informational messages |
| `header-bg` / `nav-bg` / `footer-bg` / `link` | Layout-specific |

## Button Styling

Use `getButtonClasses(variant, size, radius)` from `web/lib/theme.ts`.

| Parameter    | Options                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| **Variants** | `primary`, `destructive`, `secondary`, `warning`, `success`, `ghost`, `link`, `linkDestructive` |
| **Sizes**    | `sm`, `md`, `lg`                                                                                |
| **Radius**   | `sm` (rounded-md, most common), `md` (rounded-lg), `lg` (rounded-xl), `full` (rounded-full)     |

## Pattern Examples

```typescript
// Theme colors
import { buttonStyles, buttonSizes, borderRadius } from "@/lib/theme";

<button className={`${buttonSizes.md} ${buttonStyles.primary} ${borderRadius.md}`}>
  Save
</button>

<div className="border border-neutral-border bg-neutral-light">
  Content
</div>

<div className="border border-error-border bg-error-light text-error">
  Error message
</div>

// Avoid hardcoded colors
<button className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg">
  Save
</button>

```

## Opacity & Border Radius

Import `opacity` and `borderRadius` from `web/lib/colors.ts` for consistent
transparency and corner radii across the app.

## Interactive Feedback and Composite Controls

- Give enabled actions distinct hover feedback on hover-capable devices, using
  `@media (hover: hover)`. Provide touch feedback, visible keyboard focus, and
  persistent state cues so the control remains clear without hover.
- Compare feedback against the actual resting surface, including selected states.
  A pointer cursor alone is insufficient. Disabled actions must look unavailable.
- When a label and an icon are separate actions inside one visual segment, avoid
  stacking label padding and icon padding between them. Preserve the outer label
  padding and the icon's hit area while tightening their shared interior space.
- Shared hover feedback can cover the whole segment; give separate actions their
  own clear feedback too. Keep icon actions named for assistive technology.
- A concise title can help pointer users. Keep essential meaning and saved state
  available through labels, shape, text, or accessible state as appropriate.
- For an icon action with a non-obvious result, use existing toast or inline
  feedback after activation to explain what changed and what it means. Keep
  keyboard focus on the triggering control and expose feedback to screen readers.

## Touch Targets and Contrast

- Use at least 44 × 44 CSS px targets for touch controls. Keep adjacent actions
  separate; invisible hit areas must not overlap another control.
- Check visual balance as well as dimensions. A tall target with tight horizontal
  padding can still look cramped. Review label padding, icon spacing, and shape
  together at narrow widths, using both the preferred and fallback fonts.
- WCAG 2.2 AA uses a 24 × 24 CSS px minimum with exceptions; 44 × 44 is its
  enhanced target. Describe the project target accurately without claiming full
  accessibility conformance from dimensions alone.
- Check contrast against the actual background of enabled controls: at least
  4.5:1 for normal text and 3:1 for required control boundaries, state indicators,
  and focus indicators. Include opacity and compositing; a theme token or a
  translucent ring can still fail.

## Action Semantics

- Use `aria-pressed` for genuine two-state toggles and keep their accessible name
  stable as the state changes. Use an ordinary button for a one-way save action.
- An already completed action can use `aria-disabled` and remain focusable when
  its status or explanation needs to be heard. Guard its handler and remove
  enabled-action feedback; `aria-disabled` does not prevent activation.
- A control that shows information remains enabled, even when its underlying
  choice is already saved. Give it an accessible name for the information action.
- When a control leaves the interface, hide it from assistive technology, remove
  its tab stop, and make it inert or natively disabled while the exit animation
  finishes. Preserve focus on the active action.

## Coordinated Motion

- Animate the icon and its reserved space together when controls change size.
  Keep the final highlight aligned with the target and preserve usable hit areas.
- Handle rapid changes and reversals from the current visual state. Cancel stale
  frame loops on interruption or unmount; avoid repeatedly restarting a full
  transition while observing an element that is already resizing.
- Respect reduced motion on initial load and when the preference changes.
  Cancel existing motion and align immediately. Changing a duration variable to
  zero may leave running transitions active; explicitly disable transitions on
  every animated child and check selector specificity.

## Browser Verification

- Check narrow layouts at 320 CSS px with touch-enabled browser emulation, a coarse pointer,
  and no hover. Resizing a desktop viewport alone does not test touch behavior.
- Use actual taps to verify selection, saving, and state persistence. Check target
  dimensions and overlap, keyboard navigation, focus retention, rapid switching,
  and reduced motion, including changing the preference during an animation.
- Report how feedback was exercised. Browser emulation may expose native pressed
  states differently from hardware. An accessibility snapshot shows exposed semantics;
  record VoiceOver or TalkBack as untested unless they were actually used.

## Quick Checks

- [ ] No hardcoded Tailwind color classes (`bg-blue-*`, `text-gray-*`, `border-red-*`, etc.)
- [ ] Buttons use `getButtonClasses()` or `buttonStyles.*` from `web/lib/theme.ts`
- [ ] Color tokens match the semantic intent (e.g., `error-*` for errors, not `destructive-*`)
- [ ] Touch, keyboard, and hover-capable devices have clear feedback
- [ ] Adjacent label/icon actions avoid doubled interior spacing
- [ ] Targets, visual balance, and actual contrast were checked at narrow widths
- [ ] Button semantics match the action and disabled handlers are guarded
- [ ] Motion handles interruption and dynamic reduced-motion changes
- [ ] New colors added to `web/lib/colors.ts` first, then consumed via CSS variables

## References

- [W3C minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [W3C enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)
- [WAI button semantics](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
