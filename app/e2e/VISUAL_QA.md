# TradeLoom — visual release verification (MR14–MR21)

## Route inventory

Use `app/docs/CANONICAL_VISUAL_ROUTE_MATRIX.md` as the source of truth for routes and state coverage.
The inventory is checked against `AppShell.jsx`; redirects are not separate screens.

## Automated commands (run from `app/`)

```bash
npm install
npm run build
npm test
npx playwright install chromium
npx playwright test -c playwright.config.js e2e/visual-geometry.spec.js e2e/visual-page-coverage.spec.js e2e/visual-auth-coverage.spec.js
```

The automated browser suite covers a deterministic CSS geometry fixture, **real public Strategies**, and **real authentication login/register presentation**, at 320 / 375 / 768 / 1024 / 1440px. It measures document overflow, card/control radii, equal-width actions, component edges, and input alignment, and writes screenshots to test artifacts.

## Required authenticated screenshot review (NOT covered by the browser suite)

- Dashboard + Workshop: populated/empty/loading; cards, metrics, navigation and destructive actions.
- Bots + Bot Detail: wide/narrow headers, running/paused/failed states, orders/events/details.
- Bot Builder: create/edit, errors, long conditions, submit disabled and connected data.
- Assets / Asset Detail / Orders: search, long symbols, large tables, narrow cards and forms.
- Order Confirmation: missing order, scheduled, queued, processing, partially filled, filled and failed. **Never place live orders for visual testing.**
- Profile/account and Research: form errors, profile overflow, card and section alignment.

At each width, inspect real rendered screenshots for horizontal/vertical axes, predictable rhythm, 42px regular controls and 34px compact controls, 9px control radius and 12px card radius, semantic CTA colors, keyboard focus, no inadvertent horizontal page scrolling, and internal scrolling of wide tables.

Do not claim a green final release until build, test suites, real-route screenshots, and authenticated state walkthroughs have actually been executed and visually reviewed.

## Status at PR creation

**Unverified:** CI passes, build/tests run, screenshot review and authenticated walkthrough. The code was pushed via the GitHub contents API, without an executable local checkout. This PR adds assertions and acceptance instructions; it is a draft.
