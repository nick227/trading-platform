# Bot System — Developer Guide

This document is the working developer guide for the **rule-bot system** and the first production bot: **SPY Trend Filter**.

Canonical deep-dive: `docs/BOT-SYSTEM.md` (kept up to date with implementation).

---

## Current State (Ground Truth)

### Two-sided worker engine

File: `worker/src/engine/botEngine.js`

- For bots that include a `trend_filter` rule:
  - If current SPY position qty is `0` → evaluate as **buy**
  - If current SPY position qty is `> 0` → evaluate as **sell**
- Both paths share the same inflight protections:
  - In-memory `inflightMap` guard (fast)
  - DB fallback guard: any active `Execution` row for `(botId, ticker)` in `queued|processing|submitted|partially_filled`

Risk note:
- Alpaca positions are cached for ~60s; they can be stale right after fills.
- The inflight guards are the primary dedupe/correctness protection; do not clear them prematurely.
- To avoid DB write amplification on fast tick streams, `execution_skipped` BotEvents for repeated rule blocks are throttled (per bot+ticker+rule+reason) to at most once per minute.

### `trend_filter` rule (Alpha Engine confirmation)

File: `worker/src/engine/rules/trendFilter.js`

Reads the latest `MarketRegime` row and uses:
- `inputsJson.confirmedBars` (computed by Alpha Engine)
- `regime` (`risk_on` / `risk_off`)
- `createdAt` staleness check (`maxSnapshotAgeHours`, default template value: **90**)

Pass conditions:
- snapshot exists and not stale
- `confirmedBars >= confirmationBars` (default 2)
- side-aware regime match:
  - buy requires `risk_on`
  - sell requires `risk_off`

### `time_window` rule

File: `worker/src/engine/rules/timeWindow.js`

Config:
```json
{ "start": "09:35", "end": "09:55", "timezone": "America/New_York" }
```

### `cooldown` rule (fixed)

File: `worker/src/engine/rules/cooldown.js`

Now blocks if an execution exists for `(botId, ticker)` within the cooldown window:
- in-flight: `queued|processing|submitted|partially_filled` (by `createdAt`)
- filled: `filled` (by `filledAt`)

Config forms supported:
```json
{ "cooldownHours": 24 }
```

```json
{ "windowMs": 86400000 }
```

```json
{ "minutes": 1440 }
```

---

## Regime Pipeline (Server → DB)

Files:
- Job: `server/src/jobs/regimeSnapshotJob.js`
- Scheduler: `server/src/jobs/scheduler.js`
- Dry run: `server/scripts/regimeSnapshotDryRun.js`

Endpoint:
- `GET {ENGINE_URL}/api/regime/{ticker}`
- Header `X-Internal-Key: INTERNAL_READ_KEY`

Upsert:
- `MarketRegime(symbol, asOf)` with `inputsJson` storing the full payload for auditability.

---

## SPY Trend Filter Template

Seed: `server/prisma/seeds/bot-templates.json`

Template id: `tmpl_spy_trend_filter`

Rules:
- `time_window` (09:35–09:55 ET)
- `cooldown` (24h)
- `position_limit`
- `daily_loss`
- `trend_filter` (`confirmationBars: 2`, `maxSnapshotAgeHours: 90`)

---

## Paper Trading Checklist (Bot #1)

1. Ensure `MarketRegime` row exists for the most recent trading day:
   - Run `node server/scripts/regimeSnapshotDryRun.js` (without `REGIME_DEBUG=true`).
2. Instantiate from template via `/api/bots/catalog/from-template`.
3. Enable bot in paper account only.
4. During 09:35–09:55 ET, confirm one clear decision path is logged via `BotEvent`.
