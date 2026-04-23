# Trading Platform — Execution Engine Proposal

> **v2 — no Redis. MySQL-backed queue. In-memory bot engine. Simplified.**

---

## Overview

The platform currently handles CRUD for executions, bots, rules, and predictions. Executions are created with status `queued` and stay there — nothing ever submits them to a broker. Bots have rules but no engine evaluates them. This document proposes the **Execution Engine**: a layered sidecar that bridges the gap between recorded intent and real trades on Alpaca.

**One-line truth:** You don't need a distributed system — you need a reliable execution loop.

The design is split into four layers. The API server stays stateless and untouched. The sidecar handles everything time-sensitive.

No Redis. No external queue. MySQL is the queue.

---

## Current State

```
User → App → POST /api/executions → DB (status = "queued")    ← dead end
Bot  → DB (rules exist, enabled = true)                         ← never evaluated
alpha-engine → /api/predictions                                  ← read-only signals
prices.js → hardcoded stubs                                      ← not live
```

What's missing:
- A broker client that actually submits and confirms orders
- A poll loop that claims and processes queued executions
- A live market-data feed bots can react to
- A rule-evaluation loop that turns bot rules into execution decisions

---

## Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  App (React)                                                     │
│  - Places orders → POST /api/executions (status = queued)       │
│  - Configures bots → POST /api/bots, /api/bots/:id/rules        │
│  - Polls execution status (queued → processing → filled)        │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼───────────────────────────────────────────┐
│  API Server (Fastify — existing, unchanged)                      │
│  - All existing CRUD routes stay as-is                          │
│  - Adds: broker account management endpoints                    │
└──────────────────────┬───────────────────────────────────────────┘
                       │ Prisma / MySQL
┌──────────────────────▼───────────────────────────────────────────┐
│  MySQL Database                                                  │
│  - Execution table IS the queue (status, lockedAt, lockedBy)    │
│  - BrokerAccount stores Alpaca credentials                      │
│  - Bot + BotRule are the source of truth for engine config      │
└──────────────────────┬───────────────────────────────────────────┘
                       │ poll loop
┌──────────────────────▼───────────────────────────────────────────┐
│  Execution Engine (sidecar — new Node.js process)                │
│                                                                  │
│  ┌─────────────┐  ┌────────────────┐  ┌──────────────────────┐  │
│  │  Layer 1    │  │  Layer 2       │  │  Layer 3             │  │
│  │  Broker     │  │  Order Worker  │  │  Bot Engine          │  │
│  │  Client     │  │  DB poll loop  │  │  In-memory eval loop │  │
│  │  (Alpaca)   │  │  claim → fill  │  │  tick → rule → order │  │
│  └──────┬──────┘  └───────┬────────┘  └──────────┬───────────┘  │
│         │                 │                        │              │
│  ┌──────▼─────────────────▼────────────────────────▼──────────┐  │
│  │  Layer 4 — Market Data (Alpaca WebSocket stream)           │  │
│  │  - single connection, reference-counted subscriptions      │  │
│  │  - quote ticks → in-memory price cache                     │  │
│  │  - market open/close → engine start/stop                   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│  Alpaca API (external)                                           │
│  - Order management (REST)                                       │
│  - Account / positions (REST)                                    │
│  - Real-time quotes (WebSocket)                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Execution Lifecycle (unified)

This is the single canonical state machine. Nothing outside it.

```
         POST /api/executions
                 │
                 ▼
            [ queued ]            ← created by API or bot engine
                 │
         worker claims it
                 │
                 ▼
           [ processing ]         ← lockedBy = worker ID, lockedAt = now
           (= processingStartedAt)
                 │
         submitted to Alpaca
                 │
        ┌────────┴──────────────┐
        ▼                       ▼
  [ partially_filled ]      [ cancelled ]   ← broker rejected / user cancelled
        │                       │
  more shares filled        [ failed ]      ← max attempts exceeded
        │
        ▼
    [ filled ]                              ← all shares confirmed, terminal
```

`partially_filled` is **not terminal**. The worker continues polling Alpaca until the order is fully filled or cancelled. Only `filled`, `cancelled`, and `failed` are terminal — the worker stops touching the row once it reaches one of these.

**States:**

| Status | Terminal | Who sets it | Meaning |
|--------|----------|-------------|---------|
| `queued` | No | API server | Created, waiting for worker to claim |
| `processing` | No | Worker | Claimed, broker call in-flight |
| `partially_filled` | No | Worker | Alpaca filled some shares; still polling |
| `filled` | Yes | Worker | All shares confirmed |
| `cancelled` | Yes | Worker or API | Rejected by broker or cancelled by user |
| `failed` | Yes | Worker | Unrecoverable after max attempts |

---

## Layer 1 — Broker Client

**Purpose:** Thin, typed wrapper around the Alpaca API. The rest of the system talks to this — never directly to Alpaca.

```js
// worker/src/broker/alpacaClient.js
class AlpacaClient {
  constructor({ apiKey, apiSecret, paper = true }) {}

  async submitOrder({ ticker, side, qty, type, limitPrice }) {}
  // Returns: { alpacaOrderId, status, filledQty, filledAvgPrice, submittedAt }

  async cancelOrder(alpacaOrderId) {}
  async getOrder(alpacaOrderId) {}    // poll for fill status
  async getAccount() {}              // buying power, positions
  async getPositions() {}
}
```

**Error types:**
- `BrokerNetworkError` — retryable (timeout, 5xx)
- `BrokerRejectionError` — terminal (insufficient funds, bad symbol, market closed for that order type)
- `BrokerDuplicateError` — idempotency signal; treat as success if brokerOrderId matches

**One client per user.** The worker maintains a `Map<userId, AlpacaClient>` so credentials are loaded once per process lifetime, not per job.

**Paper vs live guard:** The AlpacaClient constructor throws if `paper = true` but `NODE_ENV = production` without an explicit `ALLOW_LIVE_TRADING=true` env flag. This makes accidental live trading impossible.

---

## Layer 2 — Order Worker (DB poll loop)

**Purpose:** Continuously claim `queued` executions from MySQL and submit them to Alpaca.

### Why MySQL as the queue?

The Execution table already exists, already has the right indexes, and is already the source of truth for order state. Adding a separate queue system (Redis, BullMQ) would introduce a second source of truth that can drift. The poll loop is simple to reason about, simple to debug, and has no infrastructure dependency beyond the DB you already have.

### Claim pattern

The worker uses an **optimistic two-step claim**: read first, then update with the same `WHERE` predicate. If another worker claimed the row between the read and the update, `updateMany` returns `count: 0` and this worker backs off cleanly.

> **Why not `UPDATE ... ORDER BY ... LIMIT 1`?** MySQL does not guarantee atomicity for that combination under concurrent connections. Two workers can both read the same LIMIT 1 row before either update commits, producing duplicate submissions. The two-step pattern uses the row's own `id` as the conflict key — `updateMany` is atomic per row.

```js
// worker/src/queues/orderWorker.js

async function claimNextExecution(workerId) {
  // Step 1 — find the oldest unclaimed job
  const job = await prisma.execution.findFirst({
    where: { status: 'queued', lockedAt: null },
    orderBy: { createdAt: 'asc' }
  })
  if (!job) return null

  // Step 2 — claim it atomically; repeat the WHERE so a concurrent worker loses the race
  const claimed = await prisma.execution.updateMany({
    where: {
      id: job.id,
      status: 'queued',   // guard: must still be queued
      lockedAt: null       // guard: must still be unclaimed
    },
    data: {
      status: 'processing',
      lockedAt: new Date(),
      lockedBy: workerId,
      attempts: { increment: 1 }
    }
  })

  if (claimed.count === 0) return null  // lost the race — another worker got it
  return job
}
```

### Processing loop

```
loop (adaptive interval):
  claim next queued execution
  if none → sleep 500ms, continue   // idle: back off to avoid busy-waiting
  // job found → process immediately, no sleep (reduces latency under load)

  load BrokerAccount for execution.userId
  if no account → mark failed, log error, continue

  // Idempotency guard — must check before every broker call
  if execution.brokerOrderId exists:
    poll Alpaca for current status → update DB → continue

  submit to Alpaca
  set execution.brokerOrderId = alpacaOrderId
  set execution.submittedAt = now
  save (so retry is idempotent)

  poll for fill (up to 30s for market orders)
  on fill → set status=filled, filledAt, filledPrice, filledQuantity
            if execution.botId → inflightMap.delete(`${botId}:${ticker}`)
  on rejection → set status=cancelled, cancelReason
                 if execution.botId → inflightMap.delete(`${botId}:${ticker}`)
  on timeout → release lock (set lockedAt=null), increment attempts
               if attempts >= 3 → set status=failed
                                   if execution.botId → inflightMap.delete(`${botId}:${ticker}`)
```

The `inflightMap` lives in the bot engine process. The order worker must hold a reference to it (passed in at startup) so it can clear the key when execution reaches any terminal state — `filled`, `cancelled`, or `failed`. Without this, the bot is permanently locked out after its first trade.

### Idempotency (non-negotiable)

Before every broker call:

```js
if (execution.brokerOrderId) {
  // Already submitted. Poll for current status instead of re-submitting.
  const order = await broker.getOrder(execution.brokerOrderId)
  await syncOrderStatus(execution, order)
  return
}
```

Without this check, a worker retry creates a duplicate trade. The `brokerOrderId` field is the idempotency key — write it to DB immediately after the broker acknowledges receipt, before polling for a fill.

### Stuck job recovery

A `processing` execution with `lockedAt` older than 2 minutes is a stuck job (worker crashed mid-flight). A separate recovery sweep runs every 60s:

```js
// Release stuck locks
await prisma.execution.updateMany({
  where: {
    status: 'processing',
    lockedAt: { lt: new Date(Date.now() - 120_000) }
  },
  data: { status: 'queued', lockedAt: null, lockedBy: null }
})
```

### Retry and failure

| Scenario | Behavior |
|----------|----------|
| Network timeout | Release lock, `attempts++`, retry on next poll |
| Alpaca rejection | `status=cancelled`, `cancelReason` set, terminal |
| Max attempts (3) | `status=failed`, terminal |
| Market closed | `status=cancelled` with reason "market_closed" |
| Insufficient funds | `status=cancelled` with reason "insufficient_funds" |

---

## Layer 3 — Bot Engine (in-memory evaluation loop)

**Purpose:** Evaluate active bot rules against live prices and create executions when rules pass. No queue. No separate worker process for bots. Evaluation is synchronous, in-memory, and happens directly on each price tick.

### Why no bot-tick queue?

Rule evaluation is fast (microseconds). It's pure in-memory logic against the price cache. Queuing bot ticks would add latency, complexity, and a second abstraction for no benefit. The execution that results from a passing evaluation goes through the order pipeline (Layer 2) like any other order.

### Bot registry

On sidecar startup, and every 3 seconds thereafter, the engine reloads all enabled bots from DB:

```js
// worker/src/engine/botEngine.js

let previousTickers = new Set()  // track last known set to diff against

async function reloadBots() {
  const bots = await prisma.bot.findMany({
    where: { enabled: true, deletedAt: null },
    include: { rules: { where: { enabled: true } } }
  })

  // Rebuild in-memory registry
  botRegistry.clear()
  const newTickerIndex = new Map()  // ticker → Set<botId>

  for (const bot of bots) {
    botRegistry.set(bot.id, bot)
    for (const ticker of bot.config.tickers ?? []) {
      if (!newTickerIndex.has(ticker)) newTickerIndex.set(ticker, new Set())
      newTickerIndex.get(ticker).add(bot.id)
    }
  }

  tickerIndex.clear()
  for (const [k, v] of newTickerIndex) tickerIndex.set(k, v)

  // Diff previous vs new ticker sets — only update subscriptions for the delta.
  // Rebuilding the full subscription list every 3s would cause churn on the WS connection.
  const newTickers = new Set(tickerIndex.keys())
  const toAdd    = [...newTickers].filter(t => !previousTickers.has(t))
  const toRemove = [...previousTickers].filter(t => !newTickers.has(t))

  if (toAdd.length)    dataStream.subscribe(toAdd)
  if (toRemove.length) dataStream.unsubscribe(toRemove)

  previousTickers = newTickers
}
```

No pub/sub. No Redis. If a bot is disabled in the UI, the next reload cycle (≤3s) will remove it from the registry. This is fast enough for an MVP and eliminates an entire infrastructure dependency.

### Tick handler

```js
// Called by Layer 4 on every quote update
function onPriceTick(ticker, quote) {
  priceCache.set(ticker, { ...quote, updatedAt: Date.now() })

  const botIds = tickerIndex.get(ticker)
  if (!botIds) return

  for (const botId of botIds) {
    const bot = botRegistry.get(botId)
    if (bot) evaluateBot(bot, ticker)
  }
}
```

### Bot evaluation

```js
// In-memory inflight map: key = `${botId}:${ticker}`, value = true
// This is the primary guard — fast, no DB round-trip on every tick.
// Periodically reconciled against DB to recover from crashes.
const inflightMap = new Map()

async function evaluateBot(bot, ticker) {
  // Re-entry guard — primary: in-memory check (no DB hit on hot path)
  const inflightKey = `${bot.id}:${ticker}`
  if (inflightMap.get(inflightKey)) {
    // Log the skip so the behavior is visible in BotEvents — not a silent no-op.
    // Without this, cooldown says "ok" but the bot does nothing and the user has no idea why.
    await logBotEvent(bot, 'execution_skipped', `Inflight order exists for ${ticker} — skipping tick`)
    return
  }

  // Re-entry guard — fallback: DB check on first evaluation after engine restart
  // or if inflightMap was cleared (e.g. process restart mid-order)
  const inflight = await prisma.execution.findFirst({
    where: {
      botId: bot.id,
      ticker,
      status: { in: ['queued', 'processing'] }
    }
  })
  if (inflight) {
    inflightMap.set(inflightKey, true)  // warm the in-memory guard
    return
  }

  // Run all rules in order — first failure short-circuits
  for (const rule of bot.rules) {
    const passed = await evaluateRule(rule, bot, ticker)
    if (!passed) {
      await logBotEvent(bot, 'execution_skipped', `Rule "${rule.name}" blocked execution`)
      return
    }
  }

  // All rules passed — create execution (enters order pipeline as queued)
  const execution = await prisma.execution.create({
    data: {
      id: generateId('exe'),
      portfolioId: bot.portfolioId,
      strategyId: bot.strategyId,
      botId: bot.id,
      ticker,
      direction: deriveDirection(bot),
      quantity: bot.config.quantity,
      // price = intent price (what the bot saw when it decided to trade).
      // filledPrice = truth (set by the order worker from the Alpaca fill).
      // Never assume ask = execution price — Alpaca may fill at midpoint or elsewhere.
      price: priceCache.get(ticker).last,
      status: 'queued',
      origin: 'bot',
      commission: 0,
      fees: 0
    }
  })

  // Mark in-memory guard immediately so subsequent ticks skip this bot+ticker
  // until the order worker clears it (on fill or cancel, worker deletes the key)
  inflightMap.set(inflightKey, true)

  await logBotEvent(bot, 'execution_created', `Order queued for ${ticker}`, { executionId: execution.id })
  // Layer 2 poll loop will pick this up within 500ms
}
```

### BotEvent structure

Every call to `logBotEvent` must produce a record matching this shape. This is what makes the system debuggable once real money is involved.

```ts
interface BotEvent {
  id:           string                  // evt_ prefix
  botId:        string
  portfolioId:  string                  // denormalized — avoids join on every query
  executionId?: string                  // set when type is execution_created
  ruleId?:      string                  // set when a specific rule triggered the event
  type:         'execution_created'
              | 'execution_skipped'
              | 'decision_made'
              | 'error_occurred'
  detail:       string                  // human-readable, one sentence
  metadata?:    Record<string, unknown> // structured context (prices, rule values, etc.)
  createdAt:    Date
}
```

**Type usage:**

| Type | When |
|------|------|
| `execution_created` | Bot successfully created a queued execution |
| `execution_skipped` | A rule blocked the trade, or inflight guard fired, or price stale |
| `decision_made` | Bot evaluated all rules and made a pass/skip decision (summary event) |
| `error_occurred` | Real failures: no broker account, DB write failed, rule evaluator threw |

Stale price data → `execution_skipped`, not `error_occurred`. Stale data is an expected market condition, not a system fault.

---

### Re-entry guard (critical)

Without the re-entry guard, a fast-moving price fires the same bot repeatedly while the first order is still processing. The guard is **two-tier**:

1. **In-memory `inflightMap`** — checked on every tick, no DB round-trip. This is the hot path. Set immediately when an execution is created; cleared by the order worker when the execution reaches a terminal state (`filled`, `cancelled`, `failed`).
2. **DB fallback** — checked only when `inflightMap` has no entry. This covers restarts: if the worker crashes mid-order, the in-memory map is empty but the DB still has a `processing` row. The fallback finds it and re-warms the map.

The two-tier design means high-frequency tickers do not flood the DB with re-entry queries.

### Rule evaluators

Each rule type is a pure function: takes rule config + live data, returns boolean.

```
market_hours:
  input: current UTC time + Alpaca market calendar (loaded at startup)
  config: { allowPremarket, allowAfterHours }
  passes: current session is within allowed windows

price_threshold:
  input: priceCache.get(ticker).last
  config: { operator: 'above'|'below', price: float }
  passes: operator condition is met
  guard: reject if cache entry is stale (updatedAt < now - 5s)

position_limit:
  input: Alpaca positions (cached, refreshed every 60s)
  config: { maxQuantity: int }
  passes: current open quantity < maxQuantity

daily_loss:
  input: sum of (filledPrice * filledQuantity) for today's sells vs buys from DB
  config: { maxLoss: float }
  passes: realized loss is below threshold

cooldown:
  input: most recent filled execution for this bot+ticker (from DB)
  config: { minutes: int }
  passes: no filled execution within the last N minutes
```

### Market data dependency separation

Manual orders placed by users go directly into the `queued` state and are **always** processed by the order worker regardless of price cache state. They are not evaluated against the cache.

Bot-originated executions are **blocked** at the rule evaluation stage if the price cache is stale for that ticker. If `priceCache.get(ticker).updatedAt < now - 5s`, the `price_threshold` evaluator returns false and logs a `BotEvent(type=execution_skipped, detail="stale price data — cache age exceeded 5s")`. The bot does not fire.

Stale data is a market condition, not a system fault — `execution_skipped` is correct. `error_occurred` is reserved for real failures: uncaught exceptions, DB write errors, missing credentials.

---

## Layer 4 — Market Data

**Purpose:** Single Alpaca WebSocket connection, fanning out quotes to the price cache and the bot engine.

### Single connection, reference-counted subscriptions

```js
// worker/src/market/dataStream.js
class MarketDataStream {
  connect()                        // opens Alpaca WS, authenticates
  subscribe(tickers: string[])     // add tickers — called with only the new delta
  unsubscribe(tickers: string[])   // remove tickers — called with only the removed delta
  onQuote(handler)                 // global quote handler
  onBar(handler)                   // 1-min OHLCV bar handler
  disconnect()
}
```

The bot engine's `reloadBots` loop computes the delta (added vs removed tickers) before calling `subscribe`/`unsubscribe`. The stream never sees a full list rebuild — only the changes. This prevents re-subscribing to tickers that were already active, which would cause the Alpaca WS connection to reset or flood with redundant subscription messages.

### Price cache

```js
// worker/src/market/priceCache.js
const cache = new Map()  // ticker → { bid, ask, last, updatedAt }

export const priceCache = {
  set(ticker, quote) { cache.set(ticker, { ...quote, updatedAt: Date.now() }) },
  get(ticker) { return cache.get(ticker) ?? null },
  isStale(ticker, maxAgeMs = 5000) {
    const entry = cache.get(ticker)
    return !entry || Date.now() - entry.updatedAt > maxAgeMs
  }
}
```

### Market calendar

On startup, fetch today's market session from Alpaca's calendar endpoint. Schedule:
- `marketOpen` → call `botEngine.start()`, begin reloadBots loop
- `marketClose` → call `botEngine.stop()`, unsubscribe all tickers

Pre/after-hours windows are stored and passed to the `market_hours` rule evaluator.

---

## Schema Extensions

Four additions to the Prisma schema.

### 1. `BrokerAccount` — Alpaca credentials per user

```prisma
model BrokerAccount {
  id        String   @id
  userId    String   @unique
  broker    String   @default("alpaca")
  apiKey    String
  apiSecret String
  paper     Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

> Secrets should be encrypted at rest before Phase 2 ships. AES-256 with a server-managed key is sufficient for now.

### 2. `Execution` — queue and fill fields

```prisma
// Add to existing Execution model:
userId          String    // required — must match BrokerAccount.userId for credential lookup
status          String    // queued | processing | partially_filled | filled | cancelled | failed
lockedAt        DateTime? // = processingStartedAt: when the worker claimed this row
lockedBy        String?   // worker instance ID
attempts        Int       @default(0)

brokerOrderId   String?
submittedAt     DateTime?
filledAt        DateTime?
filledPrice     Float?    // truth: what Alpaca actually filled at (not the intent price)
filledQuantity  Float?
cancelReason    String?
origin          String    @default("manual")  // 'manual' | 'bot'
```

**Execution timeline** — all four timestamps together give you a complete audit trail:

```
createdAt           → when the order entered the system (queued)
lockedAt            → when the worker claimed it (= processingStartedAt)
submittedAt         → when the broker call was made
filledAt            → when Alpaca confirmed the fill
```

`lockedAt` is aliased as `processingStartedAt` in queries and the UI — the column name stays `lockedAt` because it also serves as the stuck-job detection field, but its semantic meaning at runtime is "processing began at".

**`userId` invariant:** `Execution.userId` is required and must be set at creation time by the API route — either from the authenticated session (manual orders) or from `bot.userId` (bot-originated orders). The order worker uses it directly to look up `BrokerAccount`. There is no traversal through `portfolio` to find the user — that indirection introduces a join and a point of failure. One execution always maps to exactly one user, and that user must have a `BrokerAccount` row or the execution is immediately marked `failed` with `cancelReason = "no_broker_account"`.

`origin` replaces scattered `if (botId)` checks throughout the worker and reporting layer. It makes the distinction explicit in the data model rather than inferring it from a nullable foreign key.

**Migration note:** The existing `ExecutionStatus` enum (`proposed`, `filled`, `cancelled`) is replaced entirely. Drop the enum; add a `status String` column; backfill existing rows: `proposed` → `queued`. Then drop the old enum column. If the table has live traffic during migration, add the new column first, backfill, deploy the new worker, then drop the old column in a follow-up. There is no alias — `proposed` does not exist in the new system.

### 3. `Bot.config` — tickers convention

No schema change needed. Document the expected shape for bot config JSON:

```json
{
  "tickers": ["AAPL", "TSLA"],
  "orderType": "market",
  "quantity": 10
}
```

The bot engine reads `bot.config.tickers` to know which stocks to watch.

### 4. `BotRuleType` — add `cooldown`

```prisma
enum BotRuleType {
  price_threshold
  position_limit
  daily_loss
  market_hours
  cooldown          // ← new
}
```

`cooldown` config shape: `{ "minutes": 60 }`. The evaluator checks whether the bot has a `filled` execution for the target ticker within the last N minutes.

---

## New Service Topology

```
trading-platform/
├── app/                              (existing — React frontend)
├── server/                           (existing — Fastify API)
│   └── src/
│       ├── routes/
│       │   └── broker.js             (NEW: BrokerAccount CRUD)
│       └── services/
│           └── brokerService.js      (NEW: credential management)
└── worker/                           (NEW — sidecar process)
    ├── package.json
    └── src/
        ├── worker.js                 entry point
        ├── broker/
        │   └── alpacaClient.js       Layer 1
        ├── queues/
        │   └── orderWorker.js        Layer 2 — DB poll loop
        ├── engine/
        │   ├── botEngine.js          Layer 3 — registry + tick loop
        │   └── rules/
        │       ├── priceThreshold.js
        │       ├── positionLimit.js
        │       ├── dailyLoss.js
        │       ├── marketHours.js
        │       └── cooldown.js
        ├── market/
        │   ├── dataStream.js         Layer 4 — WebSocket manager
        │   ├── priceCache.js         in-memory quote store
        │   └── calendar.js           market hours scheduler
        └── db/
            └── prisma.js             shared Prisma client
```

No Redis. No BullMQ. No pub/sub infrastructure. The worker's only external dependencies are MySQL and Alpaca.

---

## Service Interaction Map

### Manual order flow

```
User places order
  App → POST /api/executions
    → API creates Execution (status=queued)
    → API returns 201 immediately

  Worker poll loop (adaptive: 0ms when jobs exist, 500ms when idle)
    → claims Execution (status=processing, lockedAt=now)
    → checks brokerOrderId → none, safe to submit
    → AlpacaClient.submitOrder()
    → writes brokerOrderId + submittedAt immediately (idempotency key)
    → polls Alpaca for fill
    → updates: status=filled, filledAt, filledPrice, filledQuantity

  App polling GET /api/executions/:id
    → sees status change from queued → filled
```

### Bot-triggered order flow

```
Market data tick (AAPL quote arrives)
  → priceCache updated
  → botEngine.onPriceTick('AAPL', quote)
    → tickerIndex lookup → finds BotA watches AAPL
    → evaluateBot(BotA, 'AAPL')
      → re-entry guard: no open orders for BotA+AAPL → proceed
      → run rule pipeline:
          market_hours → pass
          price_threshold → pass (AAPL above 185.00)
          cooldown → pass (last fill was 2h ago)
      → create Execution (status=queued, botId=BotA.id)
      → log BotEvent(execution_created)

  Worker poll loop (same loop as manual orders)
    → claims the bot-created Execution
    → submits to Alpaca
    → fills → updates Execution
    → creates BotEvent(execution_created with fill details)
```

### Bot disabled from UI

```
User disables bot
  App → PUT /api/bots/:id { enabled: false }
    → API updates DB (enabled=false)

  Bot engine reload loop (next cycle, ≤3s)
    → reloadBots() fetches enabled=true only
    → BotA removed from botRegistry
    → tickerIndex updated
    → dataStream.syncSubscriptions() removes AAPL if no other bot watches it
```

---

## Implementation Phases

### Phase 1 — Broker Foundation

1. Add `BrokerAccount` model, run migration
2. Add `broker.js` API route: POST (create), GET (masked — never return apiSecret), DELETE
3. Build `worker/src/broker/alpacaClient.js` against Alpaca paper trading
4. Write an integration test: connect, call `getAccount()`, assert response

**Exit criteria:** Can store credentials in DB and verify a connection to Alpaca paper account from a script.

### Phase 2 — Order Execution Pipeline

1. Run schema migration: add `lockedAt`, `lockedBy`, `attempts`, `brokerOrderId`, `submittedAt`, `filledAt`, `filledPrice`, `filledQuantity`, `cancelReason` to Execution
2. Drop `ExecutionStatus` enum; add `status String` column; backfill `proposed` → `queued`; deploy; drop old column
3. Build `worker/src/queues/orderWorker.js` with claim loop, idempotency guard, stuck-job recovery
4. `POST /api/executions` writes `status=queued` (no other changes to the route)
5. App polls execution status and shows fill confirmation in the UI

**Exit criteria:** User places an order in the UI, it reaches Alpaca paper account, `status` updates to `filled` within ~5s.

### Phase 3 — Market Data

1. Build `worker/src/market/dataStream.js` — connect, authenticate, subscribe/unsubscribe
2. Build `worker/src/market/priceCache.js` — set, get, isStale
3. Build `worker/src/market/calendar.js` — fetch today's session, schedule open/close events
4. Wire up stream: on connect, subscribe to a hardcoded test ticker, log quotes to console

**Exit criteria:** Price cache stays live with real quotes during market hours. Stale detection works. Market open/close events fire at the right times.

### Phase 4 — Bot Engine

1. Build `worker/src/engine/botEngine.js`: reloadBots loop, tickerIndex, onPriceTick fan-out
2. Build rule evaluators in order: `market_hours` → `price_threshold` → `cooldown` → `position_limit` → `daily_loss`
3. Wire bot engine output into the execution table (`status=queued`) so Phase 2's order worker picks it up automatically
4. Add re-entry guard to `evaluateBot`
5. Add `cooldown` to `BotRuleType` enum and schema

**Exit criteria:** A bot with a `price_threshold` rule fires an order when the price crosses. Re-entry guard prevents stacking. BotEvents log every decision and skip.

### Phase 5 — Hardening

1. Encrypt `BrokerAccount.apiSecret` at rest (AES-256, server-managed key)
2. Stuck-job recovery tested under simulated crash
3. Stale price circuit breaker: bot evaluation skips when cache is stale, logs error event
4. `position_limit` and `daily_loss` rules with live data from Alpaca + DB aggregation
5. Paper/live guard verified in production deploy
6. End-to-end test: bot fires, order fills on Alpaca sandbox, BotEvents logged correctly

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Queue system | MySQL Execution table | Already the source of truth. No second system to drift. Simple to debug — just query the DB. |
| Bot tick processing | In-memory, synchronous on each tick | Rule evaluation is microseconds. Queuing ticks adds latency and complexity for no benefit. |
| Bot config reload | DB poll every 3s | Simpler than pub/sub. 3s staleness is acceptable for enable/disable changes from the UI. |
| Broker client | One per userId, cached in worker process | Avoids per-job credential loading. Credentials are sensitive; minimize DB round-trips. |
| Inter-process comms | None | API writes to DB. Worker reads from DB. No message bus needed at this scale. |
| Paper/live guard | Constructor-level env check | Makes accidental live trading structurally impossible, not just a config error. |

---

## Decisions (closed)

Previously open questions — each has a final answer.

### 1. Partial fills

Single execution record. Track `filledQuantity` and `filledPrice` on each poll update.

`partially_filled` is an intermediate state — the worker keeps polling Alpaca until the order is fully filled or the broker cancels the remainder. Only `filled`, `cancelled`, and `failed` stop the polling loop.

Do not create child fill records. Do not requeue the remaining shares automatically. Remaining quantity is `execution.quantity - execution.filledQuantity`, surfaced to the UI. Full automation of the remainder is a future feature.

### 2. Multi-user credential isolation

`Execution.userId` is a required field (see schema above). The order worker maintains a `Map<userId, { client: AlpacaClient, updatedAt: Date }>`. Invalidation rule:

```js
const cached = clientCache.get(execution.userId)
const account = await prisma.brokerAccount.findUnique({ where: { userId: execution.userId } })

if (!account) {
  markFailed(execution, 'no_broker_account')
  return
}

if (!cached || account.updatedAt > cached.updatedAt) {
  clientCache.set(execution.userId, {
    client: new AlpacaClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, paper: account.paper }),
    updatedAt: account.updatedAt
  })
}

const broker = clientCache.get(execution.userId).client
```

One user = one `AlpacaClient` instance. Never reload credentials per job. Never share a client across users.

### 3. Bot exit rules

Deferred. Do not implement now.

The platform does not yet have position tracking in bot context or lifecycle linkage between entry and exit executions. When this is built, exit logic must be tied to open positions — not raw price ticks. The correct path: entry execution stores `predictionId`, prediction carries `targetPrice` and `stopPrice`, a future `take_profit` and `stop_loss` rule type reads those values against the position's cost basis.

### 4. Clock drift and market hours

Alpaca is the source of truth for time. Do not rely on server timezone or hardcoded hours.

On startup: fetch today's session from `GET /v2/clock` and `GET /v2/calendar`. Store `marketOpen` and `marketClose` as UTC timestamps. If `|serverTime - alpacaTime| > 2s`, log a warning — do not halt, but surface it.

Bot rule behavior: market closed → block bot execution with `BotEvent(execution_skipped)`. Manual orders: always allowed — the order worker will receive a rejection from Alpaca if the market is closed and mark the execution `cancelled` with the broker's reason.

### 5. Order worker scaling

Start with a single worker, `LIMIT 1`, 500ms poll interval. This is the correct complexity level for now.

Scale only when queue backlog grows or execution latency exceeds ~2–3s. When that point arrives:

- **Option A — batch claim:** change `LIMIT 1` to `LIMIT 10–50`, process sequentially in the loop
- **Option B — multi-worker:** run multiple worker processes; `lockedBy` with unique worker IDs makes this safe without any additional coordination

Do not parallelize within a single worker loop. Do not process the same job concurrently.

---

## Worker Heartbeat

Add a lightweight heartbeat so you can detect when the worker process has died and no executions are being processed. Without it, a dead worker is invisible — the queue fills up silently.

```prisma
// New model in schema.prisma
model WorkerStatus {
  id       String   @id  // worker process ID (e.g. hostname + PID)
  lastSeen DateTime
  startedAt DateTime @default(now())
}
```

```js
// worker/src/worker.js — runs alongside the poll loop
const WORKER_ID = `${os.hostname()}-${process.pid}`

setInterval(async () => {
  await prisma.workerStatus.upsert({
    where:  { id: WORKER_ID },
    update: { lastSeen: new Date() },
    create: { id: WORKER_ID, lastSeen: new Date(), startedAt: new Date() }
  })
}, 5000)
```

A monitoring query or admin UI endpoint can check `WHERE lastSeen < now - 30s` to detect a dead worker. This also gives you a natural place to surface worker health in the API (`GET /api/admin/worker-status`).

---

## Build Checklist

Ordered. Each step is a shippable unit. Do not start the next until the current one is testable.

- [ ] **1. Schema migration** — Add `Execution` fields: `userId`, `status`, `lockedAt`, `lockedBy`, `attempts`, `brokerOrderId`, `submittedAt`, `filledAt`, `filledPrice`, `filledQuantity`, `cancelReason`, `origin`. Add `BrokerAccount` model. Add `WorkerStatus` model. Rename `proposed` → `queued` in status values.
- [ ] **2. Broker account API** — `POST /api/broker` (create), `GET /api/broker` (masked — never return `apiSecret`), `DELETE /api/broker`. Store credentials in `BrokerAccount`.
- [ ] **3. AlpacaClient** — Typed wrapper: `submitOrder`, `cancelOrder`, `getOrder`, `getAccount`, `getPositions`. Paper/live guard in constructor. Throws typed `BrokerNetworkError` / `BrokerRejectionError`.
- [ ] **4. Order worker** — Adaptive poll loop (0ms when job found, 500ms when idle), two-step optimistic claim (`findFirst` + `updateMany`), idempotency check on `brokerOrderId`, write `brokerOrderId + submittedAt` before polling for fill. Per-user `AlpacaClient` cache with `updatedAt` invalidation.
- [ ] **5. Fill handling** — On fill: set `status=filled`, `filledAt`, `filledPrice`, `filledQuantity`, clear `inflightMap` for bot executions. On rejection: set `status=cancelled`, `cancelReason`. On timeout: release lock, increment `attempts`; mark `failed` at max attempts, clear `inflightMap`.
- [ ] **6. Stuck-job recovery** — Background sweep every 60s: unlock `processing` rows where `lockedAt < now - 2min`, reset to `queued`.
- [ ] **7. Market data** — Single Alpaca WebSocket connection. `priceCache` with `updatedAt` and `isStale(maxAgeMs)`. Market calendar fetched at startup from Alpaca (`/v2/clock`, `/v2/calendar`). Schedule `marketOpen` / `marketClose` events.
- [ ] **8. Bot engine — registry** — `reloadBots()` every 3s from DB. Maintain `botRegistry` (Map) and `tickerIndex` (ticker → Set of botIds). Diff `previousTickers` vs new tickers; call `subscribe(delta)` / `unsubscribe(delta)` only.
- [ ] **9. Bot engine — evaluation** — `onPriceTick` fan-out. `evaluateBot`: in-memory `inflightMap` check first (log `execution_skipped` on block), DB fallback on cold start. Run rule pipeline; create `Execution(status=queued, origin='bot')` on pass; log `BotEvent` for every decision.
- [ ] **10. Rule evaluators** — Implement in order: `market_hours` → `price_threshold` (with stale cache block) → `cooldown` → `position_limit` → `daily_loss`.
- [ ] **11. Worker heartbeat** — `WorkerStatus` upsert every 5s with `WORKER_ID = hostname + PID`. Expose `GET /api/admin/worker-status` from API server.
