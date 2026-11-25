# TradeLoom — route-level canonical visual inventory (MR14)

Source of truth: `app/src/app/AppShell.jsx` on the branch's base. Every path listed below was checked against the actual router. Redirect aliases are listed separately; do not build duplicate screens for them.

## Canonical route coverage

| URL | Component | Access | Owner MR | Visual contracts / states to check |
| --- | --- | --- | --- | --- |
| `/` | Welcome / HomeDashboard | Guest / signed in | MR19 / MR18 | Nav, page gutter, chart, bots, empty/error/loading |
| `/research` | Landing | Auth | MR19 | Landing surfaces, action row, information hierarchy |
| `/assets` | AssetsIndex | Auth | MR17 | Search minimum width, list header, 2→1 columns, loading |
| `/assets/:ticker` | Asset | Auth | MR17 | Header, price metrics, tables, chart and watch actions |
| `/orders` | Orders | Auth | MR17 | Header facts, trading form, orders table, empty/error |
| `/orders/confirm` | OrderConfirm | Auth | MR17 | Scheduled, queued, processing, partial, filled, failed, missing |
| `/bots` | BotsPage | Auth | MR18 | Card alignment, grouped actions, new bot CTA, empty states |
| `/bots/new` | AlgorithmBuilder | Auth | MR18 | Wizard, field pairs, condition rows, error and save |
| `/bots/:botId/edit` | AlgorithmBuilder | Auth | MR18 | Edit state, validation, save/cancel |
| `/bots/:botId` | BotDashboard | Auth | MR18 | Header CTA hierarchy, tabs/disclosures, events and orders |
| `/strategies` | StrategiesIndex | Public | MR18 | Cards, evidence, long names, all five viewports |
| `/strategies/:templateId` | StrategyDetail | Public | MR18 | Metrics, evidence, decision feed, missing/empty |
| `/profile` | AccountPage | Auth | MR19 | Account/broker form geometry, content width, notices |
| `/auth` | Auth | Guest | MR19 | Sign-in/up, form states, keyboard and mobile widths |
| `/login`, `/register` | AuthScreen | Guest | MR19 | Same canonical auth screen; no separate treatment |

## Redirects / aliases (not independent visual surfaces)

`/portfolio` → `/#holdings`; `/history` → `/bots#activity`; `/bots/create`, `/bots/create/rule-based`, `/bots/create/strategy-based`, `/bots/confirm`, `/templates`, `/templates/:templateSlug` → `/bots/new`; `/bots/:botId/history` → bot detail; `/strategies/:templateId/history` → bots featured; `/profile/account`, `/profile/broker` → `/profile`; wildcard → `/`.

The router also declares both `/bots/:botId/edit` and `/bots/:id/edit`, which resolve the same shape. Resolve ambiguity as a routing maintenance issue only if needed; do not alter routing in visual-only PRs.

## Current design ownership

- **Canonical tokens/surfaces**: `styles/product.css`, prefix `tl-`; legacy CSS token aliases in `styles/tokens/core.css`.
- **Parallel legacy families**: `styles/main.css` (`.primary`, `.ghost`), `styles/components.css` (`.btn`, `.card`), and `styles/layout.css` (`.l-*` and older aliases).
- **Page-specific CSS**: `orders.css`, `forms.css`, `home.css`, `bot.css`, `profile.css`, `wizard.css`, `landing.css`, `product.css`.
- **Known high-risk inline geometry**: `features/OrderConfirm.jsx` (many one-off card colors/widths), `features/AssetsIndex.jsx` (search min width 280px), `features/Asset.jsx` (local header/metrics), `features/bots/builder/AlgorithmBuilder.jsx` (many conditional fields).

## Canonical contract (do not add another design language)

| Relationship | Token | Value |
| --- | --- | --- |
| Regular control | `--tl-control-height` | 42px |
| Compact control | `--tl-control-height-sm` | 34px |
| Control radius | `--tl-control-radius` | 9px |
| Card radius | `--tl-card-radius` | 12px |
| Card interior | `--tl-card-padding` | 24px |
| Compact interior | `--tl-card-padding-compact` | 16px |
| Inline gap | `--tl-gap-inline` | 8px |
| Related gap | `--tl-gap-related` | 12px |
| Component gap | `--tl-gap-card` | 20px |
| Section gap | `--tl-gap-section` | 44px desktop, 36px mobile |
| Mobile gutter | `--tl-page-gutter-mobile` | 16px |

Primary violet, positive green, warning amber, destructive red; secondary stays neutral. Grouped peers use equal-width actions intentionally; toolbar actions can remain content-width.

## Acceptance / proof

For each canonical screen, verify at **320, 375, 768, 1024, 1440px**:
1. No document-level horizontal overflow; wide data tables may independently scroll.
2. Header/card/table/form left and right axes remain consistent.
3. Sibling card padding/radii and grouped action heights/widths remain consistent (1–2px tolerance for measured geometry).
4. State surfaces retain their layout in loading, empty, warning/error, expanded, and disabled states.
5. Semantic colors reflect action meaning; visible focus and accessible targets.
6. Authenticate for protected routes; use deterministic fixtures and don't make market orders for QA.
7. Capture real-route screenshots as artifacts and inspect them; fixture-only CSS checks are not sign-off.

**Verification not yet performed:** running the browser/build suites, examining screenshots, all protected-route states. MR21 owns those release gates.
