# Bot System (Rule Bots) — Developer Guide

Last updated: 2026-04-21

This repo implements a **DB-configured, worker-executed** bot system:

- The **API server** is the product/config layer (CRUD, templates, dashboards, Alpha Engine integration).
- The **worker** is the runtime layer (market data subscriptions, rule evaluation, and order queueing/execution).
- The **database** is the contract between them.

This document explains what exists today and the plan to extend it for **Bot #1: “SPY Trend Filter”**.

---

## 1) High-Level Architecture

### Core invariants

1. **The server never submits broker orders for bots.**
   - Bots enqueue `Execution(status='queued')`.
   - The worker owns broker submission, retries, reconciliation, and audit logging.

2. **The worker is DB-driven.**
   - It reads bot configuration (`Bot`, `BotRule[]`) and writes outcomes (`Execution`, `ExecutionAudit`, `BotEvent`).
   - External integrations (Alpha Engine, calendar/trading-day logic, etc.) should flow **through server → DB**.

### Runtime data flow

```
Server (bot config + Alpha Engine jobs)  ─┐
                                         │   (DB is the boundary)
DB: Bot/BotRule/MarketRegime/Execution  ─┼──> Worker: botEngine + orderWorker
                                         │
UI / API reads back events/executions   ─┘
```

---

## 2) Data Model (Prisma)

Source: `server/prisma/schema.prisma`

### Bot configuration

- `BotTemplate`
  - Reusable preset: `config` JSON + `rules` JSON array.
  - Seed file: `server/prisma/seeds/bot-templates.json`
- `Bot`
  - Runtime bot definition loaded by the worker.
  - Important fields:
    - `enabled` (worker loads only enabled bots)
    - `config` JSON (**worker expects** `config.tickers` and usually `config.quantity`/`config.direction`)
    - `deletedAt` (worker ignores soft-deleted bots)
- `BotRule`
  - Owned by `Bot` via `botId`
  - `type` enum + `config` JSON + `enabled`

### Bot telemetry

- `BotEvent`
  - “Why did/didn’t it trade?” visibility.
  - Worker writes these during rule evaluation and execution creation.
- `Execution` / `ExecutionAudit`
  - The durable order queue and audit trail (shared between manual orders and bot orders).

### Regime snapshots (for trend bots)

- `MarketRegime`
  - Daily snapshots written by the server and read by the worker.
  - Fields: `symbol`, `asOf`, `regime` (`risk_on` | `risk_off`), optional SMA inputs, etc.
  - Unique constraint: `@@unique([symbol, asOf])` (idempotent upsert)

---

## 3) Worker Runtime

### `orderWorker`: queued executions → broker

File: `worker/src/queues/orderWorker.js`

- Polls `Execution(status='queued')`, claims it, submits to Alpaca, reconciles, and writes terminal states.
- Enforces market-open at submission time via Alpaca clock (`getClock()`).

### `botEngine`: price ticks → rule evaluation → new executions

File: `worker/src/engine/botEngine.js`

- Reloads bots on an interval (`BOT_RELOAD_INTERVAL_MS`).
- Subscribes to tickers derived from `bot.config.tickers`.
- For each price tick:
  - Applies an inflight guard (in-memory + DB fallback).
  - Runs a rule pipeline (`BotRule[]`).
  - If rules pass, enqueues a new `Execution` row.

### Built-in rule types

Worker rule implementations live in `worker/src/engine/rules/`.

Current supported types:

- `market_hours`
- `price_threshold`
- `cooldown` (blocks in-flight + recent fills; see config below)
- `position_limit`
- `daily_loss`
- `trend_filter` (new; see below)
- `time_window` (new; open-window gating)

### `trend_filter` (MVP)

Files:
- Worker: `worker/src/engine/rules/trendFilter.js`
- Server enum: `BotRuleType` includes `trend_filter`

MVP behavior **today**:
- Reads the single latest `MarketRegime` row for `symbol`.
- Uses Alpha Engine-provided confirmation: `inputsJson.confirmedBars` (server stores the full payload).
- Side-aware gating:
  - `side='buy'` passes only when `regime === 'risk_on'`
  - `side='sell'` passes only when `regime === 'risk_off'`
- Uses a configurable staleness threshold against `MarketRegime.createdAt`:
  - `maxSnapshotAgeHours` default: **90** (covers weekend gaps)
  - MUST be set in rule config (template), not hardcoded per-bot

Example config:

```json
{
  "symbol": "SPY",
  "confirmationBars": 2,
  "maxSnapshotAgeHours": 90
}
```

Important: This rule is now **two-sided** via `side` passed from the bot engine (buy vs sell).

### `time_window`

Passes only when the current time (in the configured timezone) is within an inclusive `[start, end]` window.

Example config (Bot #1):

```json
{ "start": "09:35", "end": "09:55", "timezone": "America/New_York" }
```

### `cooldown`

Blocks duplicate executions in a cooldown window by looking for any matching execution for `(botId, ticker)` with status:
- in-flight: `queued`, `processing`, `submitted`, `partially_filled` (by `createdAt`)
- filled: `filled` (by `filledAt`)

Supported config forms:

```json
{ "cooldownHours": 24 }
```

```json
{ "windowMs": 3600000 }
```

```json
{ "minutes": 60 }
```

---

## 4) Server API: Bot Management + Alpha Engine

### Bot CRUD API

Routes live under `server/src/routes/bots/*` and are mounted at:

- `/api/bots/*` (authenticated)

Key endpoints (current shape):

- `GET /api/bots` — list bots (scoped to authenticated user)
- `POST /api/bots` — create bot (forces `userId=request.user.id`)
- `PUT /api/bots/:id` — update bot (owner-only)
- `DELETE /api/bots/:id` — soft delete (owner-only)
- `GET /api/bots/catalog` — list templates
- `POST /api/bots/catalog/from-template` — instantiate a bot + rules from a template
- `GET /api/bots/:id/rules` — list rules for a bot (owner-only)
- `POST /api/bots/:id/rules` — create a rule for a bot (owner-only)
- `PUT /api/bots/:id/rules/:ruleId` — update a rule (owner-only)
- `DELETE /api/bots/:id/rules/:ruleId` — delete a rule (owner-only)
- `GET /api/bots/:id/events` — list bot events (owner-only)

Implementation notes:
- The server uses `authenticate` middleware (`server/src/middleware/authenticate.js`).
- Bot services are schema-aligned: `server/src/services/botsService.js` re-exports `botsService-old.js`.

### Alpha Engine integration layer

- `server/src/clients/engine.js` — raw HTTP client (`ENGINE_URL`, `X-Internal-Key`)
- `server/src/services/alphaEngineService.js` — thin wrapper used by routes/jobs

Alpha Engine history access used for regime work:
- `alphaEngineService.getHistory(symbol, range, interval)`

---

## 5) Regime Snapshot Job (Server → DB)

Files:
- Job: `server/src/jobs/regimeSnapshotJob.js`
- Scheduler: `server/src/jobs/scheduler.js`
- Dry run script: `server/scripts/regimeSnapshotDryRun.js`

Goals:
- Fetch the latest Alpha Engine regime snapshot:
  - `GET {ENGINE_URL}/api/regime/{ticker}`
  - `X-Internal-Key: INTERNAL_READ_KEY`
- Skip on 422 (`insufficient_history`) without failing the job.
- Upsert `MarketRegime(symbol, asOf)` and store the full payload in `inputsJson` for auditability.

### How to dry-run against Alpha Engine

Run with env configured (no DB writes):

```powershell
$env:REGIME_DEBUG="true"
node server/scripts/regimeSnapshotDryRun.js
```

Notes:
- `REGIME_DEBUG=true` prints a short preview of the raw payload (first ~2KB).
- The normalizer throws if it can’t find close/time fields; fix the mapping before shipping.

---

## 6) Extension Plan: Bot #1 (SPY Trend Filter)

Product promise:
- **Risk On** (confirmed 2 daily closes): hold SPY long at target allocation.
- **Risk Off** (confirmed 2 daily closes): sell all SPY and move to cash.
- Max **one action per trading day**, executed near open.
- No shorting.

### Step A — Finish regime pipeline

1. Schedule `runRegimeSnapshot()` once daily after close (or early pre-market).
2. Ensure `MarketRegime` always has the latest trading day snapshot for `SPY`.

### Step B — Two-sided decisions (implemented)

The bot engine now supports a two-sided decision for trend bots:
- If `currentQty == 0` → attempt `buy` (gated by `trend_filter` risk_on + confirmedBars)
- If `currentQty > 0` → attempt `sell` (gated by `trend_filter` risk_off + confirmedBars)

Position source:
- `currentQty` is derived from Alpaca `getPositions()` and is cached for 60s.
- Duplicate-prevention must rely on inflight guards (`inflightMap` + DB fallback), not positions cache.

### Step C — Near-open execution window (implemented)

Bot #1 should not fire at arbitrary ticks during market hours.

Rule type: `time_window` with config like:

```json
{ "start": "09:35", "end": "09:55", "timezone": "America/New_York" }
```

### Step D — Cooldown semantics (updated)

Cooldown now checks in-flight executions as well as fills, which prevents duplicate queueing within the same day/window.

### Step E — Observability

Add BotEvent entries that explicitly log:
- latest regime + confirmation state
- snapshot age and `asOf`
- why an action was taken or blocked

---

## 7) Known Gaps / Risks (Track These)

- `authenticate` middleware is currently very verbose (logs cookies/headers).
  - Consider reducing log noise before production rollout.

---

## 8) Quick Reference

### Key files
- Worker bot engine: `worker/src/engine/botEngine.js`
- Worker order execution: `worker/src/queues/orderWorker.js`
- Bot routes: `server/src/routes/bots/*`
- Bot service: `server/src/services/botsService.js`
- Alpha Engine client: `server/src/clients/engine.js`
- Alpha Engine facade: `server/src/services/alphaEngineService.js`
- Regime job: `server/src/jobs/regimeSnapshotJob.js`
