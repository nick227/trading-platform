# TradeLoom — visual system release acceptance (MR8–MR13)

## Verification commands

From `app/` with dependencies installed:

```sh
npm run build
npm test -- --run
npx playwright test -c playwright.config.js e2e/visual-geometry.spec.js e2e/visual-page-coverage.spec.js
```

Browser checks cover the real public Strategies route plus the deterministic CSS
geometry fixture, each at 320, 375, 768, 1024, and 1440px.
They assert page overflow, card edges and padding, control height/radius,
semantic CTA colors, and grouped action widths. Screenshots are generated as
test artifacts, **not** reviewed or approved automatically.

## Authenticated page acceptance

Review Dashboard/Workshop, Bot Dashboard, Bot Builder, Strategies Detail,
Orders, Assets, and order-confirmation states at all five widths.

1. Trace left/right alignment axes across headers, section edges, card shells,
   form fields, metrics, and tables. Repeated cards need matching insets.
2. Confirm intentional 8 / 12 / 20 / 24 / 44px rhythm, with 36px mobile sections.
   Exception spacing needs design rationale.
3. Verify 42px standard controls / 34px compact controls and 9px control radii,
   with accessible mobile touch targets and keyboard focus.
4. Inspect semantic primary, secondary, positive, warning, and destructive CTA
   states: enabled, loading, disabled, focus, hover, and confirmation.
5. Check overflowing symbols, long descriptions, expanded cards, large results
   tables, and empty/error/loading forms; scroll tables in their own region.
6. Compare layouts in actual screenshots, not only the CSS fixtures; no jagged
   borders, unexpected gutters, broken baselines or excessive negative space.
7. Verify orders and assets at narrow widths; ensure two-column content stacks
   cleanly without clipping or introducing page-level scrolling.
8. Confirm light/dark contrast as applicable, no content hidden by navigation,
   and keyboard/assistive-technology access for interactive controls.

## Release gate

- Build and unit checks actually pass.
- Browser tests actually pass at all five widths.
- Authenticated screenshots inspected and visual exceptions resolved.
- No trading/risk/API behavior changed.
- Final PR rebased or retargeted onto `main` only after dependencies merge.

**Status:** This checklist and tests are committed, but CI execution,
authenticated browser verification, and screenshot sign-off are not established
by the GitHub file-writing workflow.
