# Bot Routes Summary (Server)

This document describes the bot-related HTTP routes currently mounted by the **API server** and how they connect to the **worker** and the database.

## Big Picture

- The API server is the *web/product* layer.
- The worker is the *operations/runtime* layer: it evaluates bots on ticks and enqueues `Execution` rows, then submits/cancels/reconciles with the broker.
- Bots are configuration (`Bot` + `BotRule[]`) that cause `Execution` jobs to be created by the worker.

## Data Model (What The Worker Uses)

Source: `prisma/schema.prisma`.

- `Bot`
  - `id`, `userId`, `portfolioId`, `strategyId?`, `templateId?`
  - `botType` (expected values: `rule_based` | `strategy_based`)
  - `enabled` (worker loads only `enabled=true`)
  - `config` (JSON; worker expects `config.tickers` and usually `config.quantity` / `config.direction`)
  - `deletedAt` (worker ignores bots with `deletedAt != null`)
- `BotRule`
  - Owned by a bot via `botId`
  - `type` (enum: `price_threshold` | `position_limit` | `daily_loss` | `market_hours` | `cooldown`)
  - `enabled`, `config` (JSON)
- `BotEvent`
  - Worker writes these for bot lifecycle visibility (rule blocks, execution creation, errors, etc.)

Worker behavior reference:
- Loads bots: `worker/src/engine/botEngine.js` (`enabled=true` and `deletedAt=null`)
- Subscribes to tickers: derived from `bot.config.tickers`
- When rules pass: inserts `Execution(status='queued', origin='bot', botId=...)`

## Mounted Bot Routes (Current)

Mounted in `src/loaders/routes.js`:

- `/api/bot`  → `src/routes/bot.js` (operator bot, separate concept)

### `/api/bots` Status

`/api/bots` is currently **disabled at the router level** (not mounted) to avoid exposing a schema-drifted and unsafe surface until alignment is complete.

### Operator Bot (`/api/bot`)

File: `src/routes/bot.js`

This is a separate “single-operator runtime bot” that periodically pulls Alpha Engine rankings and enqueues an `Execution` row. It is *not* the same as `/api/bots` config-driven bots.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/bot/status` | In-process operator bot status. |
| GET | `/api/bot/current-signal` | Top engine signal + explainability. |
| POST | `/api/bot/start` | Start the operator bot loop. |
| POST | `/api/bot/stop` | Stop the operator bot loop. |
| POST | `/api/bot/run-once` | Enqueue one execution from the current signal. |
| GET | `/api/bot/runs` | Recent `BotRun` history. |

Implementation reference: `src/services/botService.js` (enqueues via `src/services/executionsService.js`).

## Bot Routes Present In Code But Not Mounted

These exist under `src/routes/bots/` but are not currently registered in `src/loaders/routes.js`:

- `src/routes/bots/index.js` (intended aggregator for catalog + bots + events + rules)
- `src/routes/bots/catalog.js` (templates + create-from-template)
- `src/routes/bots/events.js` (bot events)
- `src/routes/bots/rules.js` (bot rules CRUD)

If you want full bot management (templates/rules/events) via HTTP, these need to be mounted (and aligned to the Prisma schema and worker expectations).

## Known Gaps / Rough Edges

These are the main places where the server bot API and the worker’s expectations can diverge today:

- `src/services/botsService.js` appears out of sync with the current Prisma schema:
  - It writes fields like `type` and `status`, and orders rules by `order`, but the schema defines `botType` and has no `status`/`order` columns.
  - The mounted CRUD route uses this service (`src/routes/bots/bots.js` imports `../../services/botsService.js`).
- The more schema-aligned implementation exists as `src/services/botsService-old.js` but is not currently wired into the mounted routes.

Practical impact: depending on your current DB schema, `/api/bots` create/update/list may need service/schema alignment before it is safe to rely on in production.
