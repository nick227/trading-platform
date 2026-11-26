# TradeLoom public homepage — launch acceptance

## Automated checks

Run the public-home Playwright checks in the app workspace:

```sh
npm run build
npm test -- --run
npx playwright test e2e/public-home.spec.js e2e/public-home-hardening.spec.js
```

The GitHub Visual Contracts workflow also exercises geometry and public routes. Failures should block promotion. In particular, the hero and registration must stay usable when strategy evidence, stock rankings, or the AI pipeline are unavailable.

## Content and data contracts

- Public strategy cards use the canonical `/api/public/strategies` source; no fabricated returns, chart curves, or activity timestamps.
- The stock research section reads existing Alpha Engine rankings. Rank and score are observations, not returns, personalized recommendations, or buy signals.
- Pipeline statuses come from recorded stage events. Unrecorded and failed states are never relabeled healthy.
- Price and trial language reflects the absence of an implemented Premium checkout. Do not claim that a billed trial is active.
- Auth form retains full name because the current registration contract accepts it; verify any future field removal against the backend.

## Release gates requiring deployed verification

1. Verify Railway deployed commit SHA and page availability. A passing GitHub workflow does **not** by itself prove deployment; inspect the deployment job's actual execution and conclusion.
2. In a deployment environment, register a fresh test account, sign out, sign back in, and confirm the authenticated dashboard is unchanged.
3. Verify public strategies, rankings, and pipeline output against actual backend responses. Check source freshness and incomplete/negative results.
4. On representative mobile hardware, measure Core Web Vitals: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1 at the 75th percentile. Track conditions used; CI viewport screenshots are not field performance measurements.
5. Confirm keyboard access, contrast, error announcements, and responsive layouts.
6. Review subscription and trading disclosures before announcing Premium offers. No Premium checkout is present in this release.

## Conversion measurement dependency

The current release does not transmit user journey events to analytics. Before adding persistent event collection, choose a lawful first-party analytics destination, document consent and retention policy, and test that account email/name/password and research symbols are not leaked into analytics payloads. Useful aggregate events: homepage viewed, registration started/completed, published strategy inspected, research opened, and Premium section reached.

Do not claim conversion uplift, trial enrollment, field performance, or production deployment without measurements.
