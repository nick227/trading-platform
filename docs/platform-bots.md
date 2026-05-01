# Platform Bots — Developer Guide

_Last updated: 2026-04-30_

This document covers the **platform bot model**: what it means for a strategy to be a singleton, how user subscriptions layer on top, how the aggregation API works, and the migration path toward a full signal fan-out architecture.

For the underlying rule evaluation engine and bot worker internals, see [BOT-SYSTEM.md](BOT-SYSTEM.md).

---

## 1. Mental Model

### The problem with per-user bot instances

In the legacy model every user who "runs" a bot gets their own independent `Bot` row. The worker evaluates each of those rows separately on every price tick:

```
tick → Bot(user_1) → evaluate → Execution(user_1)
tick → Bot(user_2) → evaluate → Execution(user_2)
tick → Bot(user_3) → evaluate → Execution(user_3)
```

This means:
- N users × M ticks = N×M evaluations of the same strategy logic
- Signal timing drifts between users depending on eval order
- There is no single source of truth for "what is this strategy doing right now"

### The target model

A strategy is evaluated **once per tick**. The result (a signal) fans out into per-user executions:

```
tick → Strategy(singleton) → signal → Execution(user_1)
                                    → Execution(user_2)
                                    → Execution(user_3)
```

Users **subscribe** to strategies rather than cloning them.

---

## 2. Current State (Incremental Migration)

The full signal layer does not yet exist in the DB schema. What exists today is a **subscription proxy** pattern using the `Bot` table as a stand-in for subscriptions. This is intentional — it lets the UI and aggregation API work correctly while the worker refactor is pending.

### Data model roles

| Table | Role | Notes |
|---|---|---|
| `BotTemplate` | Strategy singleton | One row per distinct strategy. This is the platform-level concept. |
| `Bot` | Subscription proxy | One row per user per template. `templateId` links back to the singleton. `enabled` = subscription active. |
| `Execution` | Truth layer | Per-user, per-fill. Never aggregated or shared across users. |

```
BotTemplate (strategy)
    │
    ├── Bot (user_1 subscription)  ──> Execution (user_1 fills)
    ├── Bot (user_2 subscription)  ──> Execution (user_2 fills)
    └── Bot (user_3 subscription)  ──> Execution (user_3 fills)
```

### Key fields

**BotTemplate** (`server/prisma/schema.prisma`):
- `id`, `name`, `description`, `botType` (`rule_based` | `strategy_based`)
- `config` — default tick/quantity settings
- `rules` — JSON array of rule definitions copied to `BotRule` on instantiation

**Bot** (subscription proxy):
- `userId` — the subscribing user
- `templateId` — which BotTemplate this was created from (null if manual)
- `enabled` — subscription active/paused
- `deletedAt` — soft-delete (subscription cancelled)

**Execution**:
- `botId` → links back to the `Bot` (subscription) that triggered it
- `pnl` — `DECIMAL(10,2)`, written on fill; used for all P&L aggregation
- `status` — `queued | processing | partially_filled | filled | cancelled | failed`

---

## 3. Platform Aggregation API

These endpoints aggregate across all subscriptions without exposing per-user data.

### `GET /api/strategies/platform`

Returns all `BotTemplate` rows with aggregate performance stats computed in a single SQL pass.

**Query params:**
| Param | Values | Default |
|---|---|---|
| `sort` | `totalPnl`, `winRate`, `subscriberCount`, `avgPnlPerSubscriber`, `tradeCount` | `totalPnl` |
| `order` | `asc`, `desc` | `desc` |

**Response shape:**
```json
{
  "data": [
    {
      "id": "btpl_...",
      "name": "Momentum Crossover",
      "description": "SMA 50 crossover + RSI confirmation",
      "botType": "rule_based",
      "subscriberCount": 12,
      "activeSubscriberCount": 9,
      "totalPnl": 4820.50,
      "winRate": 61.3,
      "tradeCount": 132,
      "avgPnlPerSubscriber": 401.71,
      "status": "running"
    }
  ]
}
```

**No per-user data is returned.** `subscriberCount` counts distinct `userId` values; P&L is aggregate across all subscribers.

**Implementation:** `server/src/services/strategiesService.js` → `getPlatformStrategies()`

The query pre-aggregates `Execution` by `botId` in a subquery before joining to `Bot`, preventing row multiplication from the `BotTemplate → Bot → Execution` join chain:

```sql
SELECT bt.id, bt.name, ...
FROM BotTemplate bt
LEFT JOIN Bot b ON b.templateId = bt.id AND b.deletedAt IS NULL
LEFT JOIN (
  SELECT botId, COUNT(*) AS tradeCount, SUM(pnl) AS totalPnl, SUM(pnl > 0) AS wins
  FROM Execution
  WHERE status = 'filled' AND pnl IS NOT NULL
  GROUP BY botId
) ea ON ea.botId = b.id
GROUP BY bt.id, ...
ORDER BY ${col} ${dir}, bt.id ASC   -- bt.id tie-breaker for pagination stability
```

The `ORDER BY` column is validated against an explicit allowlist before being passed to `Prisma.raw()` — `$queryRawUnsafe` is not used.

### `GET /api/strategies/:templateId/history`

Returns aggregate execution history for a single template. All executions across all subscribers are included; only safe fields are selected (no `userId`, `portfolioId`, `brokerOrderId`, etc.).

**Query params:** `limit` (max 200, default 100), `offset`

**Response shape:** `{ data: Execution[], pagination: { total, hasMore, nextOffset } }`

**Implementation:** `strategiesService.getStrategyHistory(templateId, query)`

---

## 4. Relevant Indexes

These indexes support the platform aggregation query efficiently:

| Table | Index | Purpose |
|---|---|---|
| `Bot` | `(templateId, userId)` | Covers template → subscriber lookup and `COUNT(DISTINCT userId)` |
| `Execution` | `(botId, status)` | Filters filled executions per bot in the subquery |
| `Execution` | `(botId, ticker, status)` | Bot engine inflight check (existing) |

---

## 5. Access Control

The platform endpoints are intentionally available to all authenticated users.

**What is shown:**
- Aggregate subscriber count
- Aggregate P&L and win rate across all subscribers
- Trade count

**What is never shown:**
- Individual user P&L
- Which users are subscribed
- Per-user execution details
- Broker order IDs or account identifiers

User-level data remains scoped to the owning user via the `/api/bots/*` routes, which filter by `request.user.id`.

---

## 6. Frontend

| Route | Component | File |
|---|---|---|
| `/bots` | Platform Bots section (bottom of page) | `app/src/features/Bots.jsx` |
| `/strategies/:templateId/history` | Aggregate execution history | `app/src/features/StrategyHistory.jsx` |

The Platform Bots table in `Bots.jsx` sorts server-side — clicking a column header updates `platformSort` state `{ sort, order }`, which triggers a re-fetch rather than a client-side sort. This keeps sort behaviour correct once pagination is added.

The `StrategyHistory` page fetches the template's aggregate stats (for KPIs) and execution history in parallel on mount. It shows P&L, win rate, execution count, and subscriber count — no per-user row in sight.

---

## 7. Worker: Current vs Target Evaluation

### Current (per-subscription evaluation)

`worker/src/engine/botEngine.js` loads all enabled `Bot` rows and evaluates each independently:

```js
// Simplified
const bots = await prisma.bot.findMany({ where: { enabled: true, deletedAt: null } })

for (const bot of bots) {
  await evaluateBot(bot, ticker)   // fetches positions for bot.userId, places orders
}
```

This works correctly but duplicates strategy computation across subscribers.

### Target (signal fan-out)

Group bots by `templateId`, evaluate once per group, fan out into per-user executions:

```js
const groups = groupBy(bots, 'templateId')

for (const templateId of Object.keys(groups)) {
  const signal = evaluateStrategy(templateId, tick)   // evaluated once
  if (!signal) continue

  for (const bot of groups[templateId]) {
    await createExecution(bot.userId, bot.portfolioId, signal)
  }
}
```

**This requires no schema change.** `Bot` rows remain as the subscription list. The only change is in how the worker loops. The signal layer (`StrategySignal` table) can be introduced alongside this to persist signals for auditability, but is not required for correctness.

### Why this is not yet done

The current evaluation logic in `evaluateBot()` is tightly coupled to individual `Bot` config (tickers, quantity, direction, capital mode). Decoupling "what to trade" (template-level) from "how much to trade" (subscription-level sizing) is the prerequisite for the refactor. The aggregation API and UI are ready — the worker refactor is the remaining step.

---

## 8. Migration Checklist

| Step | Status | Notes |
|---|---|---|
| `BotTemplate` as singleton concept in UI | ✅ Done | Platform Bots section in `/bots` |
| Aggregate API (`/api/strategies/platform`) | ✅ Done | SQL aggregation, no JS fan-out |
| Strategy history API (`/api/strategies/:id/history`) | ✅ Done | Pagination, no per-user data |
| `StrategyHistory` frontend | ✅ Done | |
| Composite indexes (`Bot(templateId,userId)`, `Execution(botId,status)`) | ✅ Done | Applied via `prisma db push` |
| Pre-insert idempotency guard on `activeIntentKey` | ✅ Done | `findUnique` before `create`; `withInflightLock` wraps the insert with a `finally`-safe release; `duplicate_prevented` / `duplicate_race_condition` metrics + log events |
| Worker: grouped evaluation (signal fan-out) | ⬜ Pending | No schema change required |
| `StrategySignal` table (signal audit log) | ⬜ Pending | Schema addition needed |
| Replace `Bot` with `StrategySubscription` table | ⬜ Pending | Breaking change — needs migration |
| `StrategyRuntime` table (live status, `lastEvaluationAt`) | ⬜ Pending | Schema addition needed |
| `BotTemplate.subscriberCount` materialized column | ⬜ Pending | Optimization for `COUNT(DISTINCT userId)` at scale |
