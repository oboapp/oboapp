---
name: tailwind-theme
description: Color system, button styling, and theme conventions for the web package
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
---

# Tailwind Theme System Skill

**IMPORTANT**: Using Tailwind Theme skill! Never hardcode colors — always use theme tokens.

## Architecture

- **Single source of truth:** `web/lib/colors.ts` — All color definitions
- **CSS variables:** `web/app/globals.css` — Theme implementation via Tailwind v4 @theme
- **Component utilities:** `web/lib/theme.ts` — Button styles and helpers

## Color Categories

| Token prefix                                  | Purpose                                     | Example hex      |
| --------------------------------------------- | ------------------------------------------- | ---------------- |
| `primary` / `primary-hover`                   | Primary actions                             | #1976D2 (blue)   |
| `destructive` / `destructive-hover`           | Destructive actions                         | #E74C3C (red)    |
| `neutral` / `neutral-*`                       | Borders, backgrounds, text, disabled states | gray equivalents |
| `error` / `error-*`                           | Validation errors, error messages           | red              |
| `warning` / `warning-*`                       | Warnings, caution states                    | amber/yellow     |
| `success` / `success-*`                       | Success states, confirmations               | green            |
| `info` / `info-*`                             | Informational messages                      | blue             |
| `header-bg` / `nav-bg` / `footer-bg` / `link` | Layout-specific                             | —                |

## Button Styling

Use `getButtonClasses(variant, size, radius)` from `web/lib/theme.ts`.

| Parameter    | Options                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| **Variants** | `primary`, `destructive`, `secondary`, `warning`, `success`, `ghost`, `link`, `linkDestructive` |
| **Sizes**    | `sm`, `md`, `lg`                                                                                |
| **Radius**   | `sm` (rounded-md, most common), `md` (rounded-lg), `lg` (rounded-xl), `full` (rounded-full)     |

## Pattern Examples

```typescript
// ✅ Good — Using theme colors
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

// ❌ Bad — Hardcoded colors
<button className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg">
  Save
</button>

<div className="border border-gray-200 bg-gray-50">
  Content
</div>

<div className="border border-red-200 bg-red-50 text-red-700">
  Error message
</div>
```

## Opacity & Border Radius

Import from `web/lib/colors.ts`: `opacity`, `borderRadius`. Use for consistent spacing and transparency across the app.

## Quick Checks

- [ ] No hardcoded Tailwind color classes (`bg-blue-*`, `text-gray-*`, `border-red-*`, etc.)
- [ ] Buttons use `getButtonClasses()` or `buttonStyles.*` from `web/lib/theme.ts`
- [ ] Color tokens match the semantic intent (e.g., `error-*` for errors, not `destructive-*`)
- [ ] New colors added to `web/lib/colors.ts` first, then consumed via CSS variables
