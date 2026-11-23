# Bot configuration API (unified save)

This is the one way for the Algorithm Builder to create or edit a bot. Each call saves the bot **and** its rules in a single transaction: every change is written, or none is.
Implementation: `server/src/services/botConfigService.js`. Tests: `server/test/integration/botConfiguration.test.js`.

| | |
|---|---|
| Create | `POST /api/bots/configuration` → `201` |
| Update | `PUT /api/bots/:id/configuration` → `200` |
| Load | `GET /api/bots/:id` (unchanged; returns `config`, `rules[]` and `updatedAt`) |

All of these require the session cookie (or a Bearer token), like every other `/api` route.

## Request body

| Field | Create | Update | Meaning |
|---|---|---|---|
| `portfolioId` | required | not allowed | Must belong to the user. |
| `templateId` | optional | not allowed | A starting point. Its `config` and `rules` are the starting values. |
| `name` | required unless `templateId` | optional | 1–100 chars. With a template, defaults to the template name. |
| `enabled` | optional (default `false`) | optional | `true` starts or resumes the bot. Refused while the emergency stop is on. |
| `config` | optional | optional | **Patch**, deep-merged into the stored config (or into the template config on create). |
| `rules` | optional | optional | **The full desired rule set**. See below. |
| `expectedUpdatedAt` | — | optional, recommended | The `updatedAt` you loaded. If the bot changed since, you get `409 STALE_BOT`. |

### `config`: patch semantics
- Keys you don't send are **kept**. This includes settings the builder doesn't show (`riskLimits`, `positionSizing`, `timezone`, `riskOnExposure`, …) and the research policy.
- Plain objects merge key by key: `{ "research": { "minConfidence": 0.6 } }` changes only that one research field.
- Arrays and scalars replace: `{ "tickers": ["NVDA"] }`.
- `null` removes a key: `{ "timezone": null }`.
- Normalization: tickers are trimmed and upper-cased. `capitalMode: "allocated"` is set when `allocatedAmount` is present and no mode was given.
- Validated on the **merged** result:

| Field | Rule |
|---|---|
| `tickers` | at least one |
| `direction` | `buy` \| `sell` |
| `allocatedAmount`, `maxOrderNotional`, `quantity` | > 0 |
| research policy (when `signalSource: "alpha_research"`) | `minConfidence` 0–1; `maxPredictionAgeHours` 1–720; `maxEntryDriftPct` 0–50; `requireEdgeOverBaseline` boolean; `allowedHorizons` non-empty string[] |

### `rules`: full set with stable identity
- **Omit `rules`** to leave the rules untouched.
- When sent, the array is the complete set:
  - `{ "id": "rule_…", … }` keeps that rule (same id). Send only the fields you change. An unchanged rule is not rewritten.
    - **`config` replaces that rule's config** (rule configs are small; send the whole thing).
    - `type` can't change.
  - `{ "type": "…", "config": {…}, "name"?: "…", "enabled"?: true }` with no `id` creates a rule. `name` defaults to e.g. "Cooldown".
  - Existing rules you don't list are **deleted**.
- Rule types and their validation (the server is authoritative):

| Type | Valid config |
|---|---|
| `price_threshold` | `{ price > 0, operator: "above" \| "below" }` |
| `cooldown` | `{ windowMs > 0 }` (or `minutes` / `cooldownHours`) |
| `position_limit` | `{ maxShares \| maxQuantity \| maxPositions > 0 }` |
| `daily_loss` | `{ maxLoss > 0 }` or `{ maxDailyLossPct: (0, 100] }` (realized loss, account-wide) |
| `time_window` | `{ start: "HH:MM", end: "HH:MM", timezone? }` with start < end |
| `market_hours` | `{ allowPremarket?: bool, allowAfterHours?: bool }` |
| `trend_filter` | `{ symbol?: "SPY" }` |

- All conditions combine with AND.
- On create with a `templateId` and no `rules`, the template's rules are used **and validated**. Starting points with an unset trigger price must send their rules with the user's price.

## Response
```json
{
  "data": {
    "id": "bot_…", "userId": "usr_…", "portfolioId": "prt_…", "templateId": "tmpl_momentum_buy",
    "botType": "rule_based", "name": "MSFT breakout", "enabled": true,
    "config": { "tickers": ["MSFT"], "direction": "buy", "allocatedAmount": 5000, "maxOrderNotional": 1000, "capitalMode": "allocated", "riskOnExposure": 1 },
    "updatedAt": "2026-11-22T23:40:00.000Z",
    "rules": [
      { "id": "rule_…", "type": "price_threshold", "name": "Price trigger", "config": { "price": 410, "operator": "above" }, "enabled": true },
      { "id": "rule_…", "type": "cooldown", "name": "Cooldown", "config": { "windowMs": 3600000 }, "enabled": true }
    ]
  },
  "changes": { "rulesCreated": 2, "rulesUpdated": 0, "rulesDeleted": 0, "rulesUnchanged": 0 }
}
```
Keep `data.updatedAt` and send it back as `expectedUpdatedAt` on the next save.

## Examples

**Create from a starting point** (builder "Start bot"):
```json
POST /api/bots/configuration
{
  "portfolioId": "prt_1795319047286_59e02e2e",
  "templateId": "tmpl_momentum_buy",
  "name": "MSFT breakout",
  "enabled": true,
  "config": { "tickers": ["MSFT"], "allocatedAmount": 5000, "maxOrderNotional": 1000 },
  "rules": [
    { "type": "price_threshold", "config": { "price": 410, "operator": "above" } },
    { "type": "market_hours", "config": {} },
    { "type": "cooldown", "config": { "windowMs": 3600000 } }
  ]
}
```

**Create a research bot from scratch:**
```json
POST /api/bots/configuration
{
  "portfolioId": "prt_…", "name": "Research follower",
  "config": {
    "tickers": ["AAPL", "MSFT"], "allocatedAmount": 10000, "maxOrderNotional": 2000,
    "signalSource": "alpha_research",
    "research": { "minConfidence": 0.45, "maxPredictionAgeHours": 96, "maxEntryDriftPct": 5, "requireEdgeOverBaseline": true }
  },
  "rules": [{ "type": "market_hours", "config": {} }]
}
```

**Edit**: change the trigger, add a daily-loss limit, remove the cooldown, keep market hours as it is:
```json
PUT /api/bots/bot_…/configuration
{
  "expectedUpdatedAt": "2026-11-22T23:40:00.000Z",
  "config": { "maxOrderNotional": 1500 },
  "rules": [
    { "id": "rule_price", "config": { "price": 420, "operator": "above" } },
    { "id": "rule_hours" },
    { "type": "daily_loss", "config": { "maxLoss": 300 } }
  ]
}
```
Result: `changes = { rulesUpdated: 1, rulesUnchanged: 1, rulesCreated: 1, rulesDeleted: 1 }`.

**Pause / resume / rename only:** `PUT … { "enabled": false }`. Rules and config are untouched, and the pause/resume event is recorded.

## Errors
Every error has the shape `{ "error": { "code", "message", …details } }`. Nothing is written when an error is returned.

| Status | `code` | Details | When |
|---|---|---|---|
| 400 | `INVALID_CONFIG` | `field` (`tickers`, `direction`, `allocatedAmount`, `maxOrderNotional`, `quantity`, `research`, `name`, `portfolioId`, `templateId`, `config`, `enabled`) | Invalid bot field (on the merged config) |
| 400 | `INVALID_RULE` | `ruleIndex` (index in your `rules` array), `ruleId?`, `type?` | Invalid rule config, unknown or repeated id, type change, bad name |
| 400 | `INVALID_PORTFOLIO` | — | Portfolio missing or not yours (create) |
| 404 | `NOT_FOUND` | — | Bot missing, deleted, or not yours (update) |
| 404 | `TEMPLATE_NOT_FOUND` | — | Unknown `templateId` |
| 403 | `EMERGENCY_STOP_ACTIVE` | — | `enabled: true` while the stop is on. Saving with `enabled: false` (or omitted) still works. |
| 403 | `BROKER_NOT_CONFIGURED` / `BROKER_CREDENTIALS_INVALID` / `LIVE_TRADING_DISABLED` | — | Live mode only, on create or resume; the simulator never returns these |
| 409 | `STALE_BOT` | `updatedAt` (current) | `expectedUpdatedAt` doesn't match. Reload the bot and re-apply. |

Example: `400 { "error": { "code": "INVALID_RULE", "message": "Trigger price must be greater than 0.", "ruleIndex": 0, "type": "price_threshold" } }`. Show it inline on the rule at `ruleIndex`.

## Retired endpoints
The unified save replaced these: `POST /api/bots`, `POST /api/bots/catalog/from-template`, and `POST/PUT/DELETE /api/bots/:id/rules*`.
`PUT /api/bots/:id` now only pauses or resumes (`{ "enabled": true|false }`). Any other field returns `400 USE_CONFIGURATION_ENDPOINT`. The reads (`GET /api/bots`, `/:id`, `/:id/rules`, `/catalog`) are unchanged.
