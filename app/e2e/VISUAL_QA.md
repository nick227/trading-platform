# TradeLoom visual-system acceptance

Run from `app/` after starting the API and seeding demo data:

```sh
npx playwright test -c playwright.config.js e2e/visual-geometry.spec.js
npm run build
npm test -- --run
```

The geometry spec renders deterministic controls with the **real app stylesheet**, checks
shared edges, equal-width sibling actions, 42px control heights, semantic color
distinction and horizontal overflow at 320, 375, 768, 1024 and 1440px.
Screenshots are written to Playwright's test output directory. They are **not**
golden snapshots and are not a substitute for a human review of the actual app.

## Authenticated visual acceptance (manual)

For each of the widths above, verify in Strategies, Strategy Detail, Bots,
Bot Dashboard and Workshop:

- Page and card left/right edges align; no jagged indentation or unexplained gaps.
- Headings and action regions remain on intentional axes.
- Sibling actions are equal width within groups; mobile stacks instead of clipping.
- Create/Customize (brand/neutral), Resume (positive), Pause (warning), Stop
  (destructive) have distinguishable accessible states and clear semantics.
- Controls beside one another have matching heights and radii.
- Form labels, inputs and help text align; errors do not overlap actions.
- Metric values use tabular numerals and share stable label/value axes.
- Expanders, long strategy names, and empty/error/loading states do not shift
  unrelated content or create horizontal page scrolling.
- Wide results tables scroll **inside their container**, never the document.
- Keyboard focus is visible; disabled actions remain clearly disabled.
- Test both light-on-color text contrast and mobile touch targets.

## Scope and limitations

MR1–MR5 supply shared tokens, button semantics, layout primitives,
page integration and mobile geometry. This MR supplies deterministic browser
contract coverage and a real-page review checklist. **Real-page screenshots,
cross-browser comparison, deployment, and CI execution remain unverified until
run in an app environment.** No execution, risk policy, or research logic is
changed by this series.
