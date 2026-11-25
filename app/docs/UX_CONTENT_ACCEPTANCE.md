# UX MRs 75–82 — final acceptance evidence

## Coverage and provenance
The route inventory lives at `app/docs/UX_CONTENT_CONTRACT.md`. The UX series keeps backend execution, order handling, risk policy, and strategy calculations unchanged. Presentation now separates public-facing summaries, factual empty states and technical records.

Automated checks cover:
- Vitest for content components and evidence helpers, plus all existing app unit tests
- The actual Strategy Detail React route with a **deterministic AI strategy and no performance**, rendered at 320, 375, 768, 1024, 1440px
- Strategy identity, human purpose, no raw version hash in primary identity, separate technical disclosures, and empty results state
- Existing public Strategies and authenticated mocked-page Playwright visual coverage

## Human-review gate
**Do not treat passing tests alone as user comprehension approval.** Review artifacts for the following at 375px and 1440px:
- Long titles, tags, primary action and metadata separate and aligned
- No duplicate configuration facts or contradictory information
- Human-readable results/error/empty status; distinguish historical tests from simulated forward outcomes
- Expanded details maintain a clear reading order; version history and technical terms are subordinate
- No horizontal overflow or clipped controls
- Screens use representative populated data as well as empty states

**Limits:** Browser fixtures are deterministic and do not constitute live brokerage or operational verification. Full populated AI decisions, all execution statuses, and every account-specific variant require separate review. This document must be amended with CI run URL and reviewer notes before unconditional release sign-off.
