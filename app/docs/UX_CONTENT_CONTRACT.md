# TradeLoom: UX & content quality contracts — MR 75
Source: `app/src/app/AppShell.jsx`, route components and screenshots from the strategy detail review.
This inventory covers **every canonical route**. Redirect aliases do not represent independent surfaces.

| Route(s) | Owner | Primary comprehension defects / review state |
| --- | --- | --- |
| `/` guest | MR 81 | Explain what the product offers before implementation terminology |
| `/` signed in | MR 80 | Differentiate simulated portfolio, activity, bot status and evidence; avoid duplicate totals |
| `/strategies` | MR 79 | AI chips crowd title; "Forward paper" and "Holdout" unexplained; unavailable results lack guidance |
| `/strategies/:templateId` | MR 78 | **P0 reference case**: title metadata crowding; raw version hash; Objective/Benchmark/Parameters jargon; redundant "Forward paper"; Settings duplicate capital limits; Methodology mixes risks, algorithms and version history |
| `/research` | MR 79 | Research sections have independent card composition; data freshness and model caveats buried; explain outcomes before scores |
| `/bots` | MR 80 | Featured bot and performance labels mix technical evidence and paper trading; outcome-first descriptions |
| `/bots/new`, `/bots/:botId/edit` | MR 80 | Maker workflow: clarify trigger, limits, and safeguards before saving; actionable validation |
| `/bots/:botId` | MR 80 | Backtest vs ongoing trading labels; dense decision feed and technical IDs |
| `/assets` | MR 81 | Search, favorite ticker groups and quote freshness need consistent editorial framing |
| `/assets/:ticker` | MR 81 | Price context, ownership, and trade CTA need clear units and separation |
| `/orders` | MR 81 | Explain estimated costs, quote freshness, and trading/simulation mode |
| `/orders/confirm` | MR 81 | Distinguish order submitted, queued, filled, failed; avoid repeated values and one-off copy |
| `/profile` | MR 81 | Simulation-account status should use one succinct explanation and aligned financial facts |
| `/auth`, `/login`, `/register` | MR 81 | Shared authentication status, form errors and next steps |

## Canonical composition contract
1. **Identity:** heading, one-sentence purpose, state label, primary action; metadata below or inside technical details.
2. **Evidence:** plain status + available result, then supporting metrics and source; never present a backtest as a forward result.
3. **Configuration:** group monetary limits, schedule, and safeguards; show the same fact once.
4. **Decision history:** outcome, explanation, source, time, with technical payload behind disclosure.
5. **Methodology:** user-relevant limitations first; algorithm details, raw policy identifiers, and version history in distinct disclosures.
6. **Empty/error:** identify which information is missing and why (when known), without implying inactivity or success.
7. **Space:** headline, metadata, header actions, and each section have stable alignment axes. Test long names and 320–1440 widths.
8. **Accuracy:** do not fabricate broker connectivity, strategy actions, AI reasoning, performance, source timeliness, or risk guarantees.

## Source-of-truth mapping
- Strategy display and evidence: `ui/strategyPresentation.js`, `features/strategies/strategiesApi.js`, `StrategyDetail.jsx`.
- Bot execution clauses: `ui/describeBot.js`; do **not** change these execution-derived facts when changing presentation.
- Bot data: `features/bots/botsApi.js`, `api/services/botDashboardService.js`.
- Historical testing and decision details: `features/strategies/StrategyDetail.jsx` (raw method and version fields remain accessible).
- Mode and broker: `components/ModeBadge.jsx`, `app/AuthProvider.jsx`.
- Canonical visual tokens: `styles/product.css`; content composition styles to remain separately owned.
- Existing route/screenshot checks: `e2e/visual-page-coverage.spec.js`, `visual-auth-coverage.spec.js`, `visual-protected-routes.spec.js`.

## Release gates
- Each migration PR adds state fixtures and copy assertions for changed pathways.
- Never conflate simulated, historical, replay, and real transactions.
- Verify loading, empty, error, populated and disclosure states; screenshots at 375 and 1440px plus overflow at 320px.
- A passing CSS/Playwright test is *not* evidence of understandable copy; record reviewer sign-off separately.
- Keep backend execution and authorization unmodified.
