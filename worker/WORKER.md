# Worker — Developer Reference

The worker is a long-running Node.js process that sits beside the API server. It owns everything that touches a real broker: market data, bot evaluation, and order submission. The API server never calls Alpaca directly.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Layer Breakdown](#layer-breakdown)
3. [End-to-End Flow](#end-to-end-flow)
   - [Manual Order](#manual-order-flow)
   - [Bot-Triggered Order](#bot-triggered-order-flow)
4. [Execution State Machine](#execution-state-machine)
5. [Bot Engine Deep Dive](#bot-engine-deep-dive)
6. [Rule Evaluators](#rule-evaluators)
7. [Order Worker Deep Dive](#order-worker-deep-dive)
8. [Multi-Tenant Isolation](#multi-tenant-isolation)
9. [Market Data Layer](#market-data-layer)
10. [File Reference](#file-reference)
11. [Adding a New Rule Type](#adding-a-new-rule-type)
12. [Environment Variables](#environment-variables)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  API Server (Fastify)                                           │
│  POST /api/executions → writes Execution{status: queued}        │
│  POST /api/bots       → writes Bot + BotRule[]                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ shared MySQL database
┌──────────────────────────▼──────────────────────────────────────┐
│  Worker Process                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Bootstrap (worker.js)                                   │   │
│  │  • initInflightMap from DB                              │   │
│  │  • start order worker loop                              │   │
│  │  • open Alpaca WebSocket (market data stream)           │   │
│  │  • check market clock → start/schedule bot engine       │   │
│  │  • heartbeat every 5s → WorkerStatus table              │   │
│  └────────┬────────────────────────┬────────────────────────┘  │
│           │                        │                            │
│  ┌────────▼──────────┐   ┌─────────▼──────────────────────┐   │
│  │  Market Layer     │   │  Bot Engine                     │   │
│  │                   │   │  (engine/botEngine.js)          │   │
│  │  dataStream.js    │   │                                 │   │
│  │  Single Alpaca WS │──▶│  reloadBots() every 3s          │   │
│  │  onStockQuote     │   │  subscribe/unsubscribe delta     │   │
│  │  onStockBar       │   │  onPriceTick → evaluateBot()    │   │
│  │                   │   │  Rule pipeline → Execution row  │   │
│  │  priceCache.js    │   │  inflightMap guard               │   │
│  │  priceCache       │◀──│  positionCacheByUser (LRU 500)  │   │
│  │                   │   └─────────────────────────────────┘   │
│  │  calendar.js      │                                         │
│  │  market hours     │   ┌─────────────────────────────────┐   │
│  │  open/close sched │   │  Order Worker                   │   │
│  └───────────────────┘   │  (queues/orderWorker.js)        │   │
│                           │                                 │   │
│  ┌────────────────────┐   │  poll queued executions         │   │
│  │  Broker Layer      │   │  two-step optimistic claim      │   │
│  │                   │   │  submit → brokerOrderId written  │   │
│  │  alpacaClient.js  │◀──│  pollUntilFilled (30s timeout)  │   │
│  │  AlpacaClient     │   │  stuck-job recovery every 60s   │   │
│  │  BrokerNetworkErr │   │  inflightMap.delete on terminal  │   │
│  │  BrokerRejection  │   └─────────────────────────────────┘   │
│  │                   │                                         │
│  │  clientCache.js   │                                         │
│  │  per-user client  │                                         │
│  │  cache (updatedAt │                                         │
│  │  invalidation)    │                                         │
│  └───────────────────┘                                         │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Alpaca (external)                                              │
│  REST API: orders, positions, account, clock, calendar          │
│  WebSocket: real-time quotes and bars per ticker                │
└─────────────────────────────────────────────────────────────────┘
```

The API server and worker communicate exclusively through the database. The API server writes `Execution` rows with `status: queued`. The worker polls, claims, submits to Alpaca, and writes the terminal state back. Neither process calls the other over HTTP.

---

## Layer Breakdown

| Layer | Files | Responsibility |
|---|---|---|
| Bootstrap | `worker.js` | Wires all layers together, starts heartbeat, gates bot engine on market hours |
| Market Data | `market/dataStream.js`, `market/priceCache.js`, `market/calendar.js` | Single Alpaca WebSocket, in-memory price cache, market open/close scheduling |
| Bot Engine | `engine/botEngine.js`, `engine/rules/*.js` | Reloads bot registry, routes price ticks to rule pipelines, creates Execution rows |
| Order Worker | `queues/orderWorker.js` | Claims queued executions, submits to Alpaca, polls for fill, writes terminal state |
| Broker | `broker/alpacaClient.js`, `broker/clientCache.js` | Alpaca SDK wrapper, per-user client cache with credential-rotation invalidation |
| DB | `db/prisma.js` | Shared Prisma client pointing at `server/prisma/schema.prisma` |

---

## End-to-End Flow

### Manual Order Flow

A user clicks "Place Order" in the UI. Here is the full path from button press to confirmed fill.

```
UI (OrderConfirm.jsx)
  └─ POST /api/executions
       └─ executionsService.createExecution()
            └─ prisma.execution.create({ status: 'queued', origin: 'manual' })
                                                │
                                         [MySQL row written]
                                                │
Worker: orderWorker poll loop (every 500ms when idle)
  └─ claimNextExecution()
       ├─ findFirst({ status:'queued', lockedAt:null })  ← step 1
       └─ updateMany({ id, status:'queued', lockedAt:null },
                     { status:'processing', lockedAt:now, lockedBy:workerId })
                                                │       ← step 2 (atomic claim)
  └─ processExecution(job)
       ├─ getBrokerClient(execution.userId)     ← loads per-user Alpaca client
       ├─ broker.getOrderByClientOrderId(clientOrderId)  ← reconcile crash window before submit
       ├─ broker.submitOrder({ ticker, side, qty, type:'market', clientOrderId })
       │    └─ Alpaca REST: POST /v2/orders
       ├─ prisma.execution.update({ brokerOrderId, clientOrderId, submittedAt, status:'submitted' })
       └─ pollUntilFilled(execution, broker)    ← poll every 2s, timeout 30s
            ├─ broker.getOrder(brokerOrderId)
            │    └─ Alpaca REST: GET /v2/orders/:id
            └─ on filled → terminate(execution, 'filled', null, { filledAt, filledPrice, filledQuantity })

UI: startStatusPolling()
  └─ GET /api/executions/:id  every 2s
       └─ renders queued → processing → filled status banners
```

**Why two-step claim?** MySQL does not guarantee atomicity when using `UPDATE ... ORDER BY ... LIMIT 1`. Two workers running concurrently could both read the same `findFirst` result and both attempt to claim it. The `updateMany` uses the same `WHERE` predicate as the `findFirst`. Only one worker's `updateMany` will match (the other sees `count = 0`), so only one worker processes the job.

---

### Bot-Triggered Order Flow

The bot engine runs while the market is open. Price ticks drive evaluation.

```
Alpaca WebSocket (market data stream)
  └─ onStockQuote({ S: 'AAPL', ap: 182.50, bp: 182.48 })
       └─ priceCache.set('AAPL', { bid, ask, last, updatedAt })
       └─ quoteHandler('AAPL')  ← wired in worker.js: onQuote → onPriceTick

botEngine.onPriceTick('AAPL')
  └─ tickerIndex.get('AAPL')  → Set{ 'bot_123', 'bot_456' }
  └─ for each botId → evaluateBot(bot, 'AAPL')

evaluateBot(bot, 'AAPL')
  ├─ [1] inflightMap.get('bot_123:AAPL')  → guard: skip if true (in-memory, no DB)
  ├─ [2] prisma.execution.findFirst({ botId, ticker, status: ['queued','processing','submitted','partially_filled'] })
  │       → cold-start fallback; `activeIntentKey` is the database dedupe boundary
  ├─ [3] getPositions(bot.userId)          → per-user Alpaca REST + LRU cache (60s TTL)
  └─ [4] rule pipeline (first failure short-circuits):
          ├─ evaluateMarketHours(config)    → checks calendar.getMarketHours()
          ├─ evaluatePriceThreshold(config, 'AAPL')  → reads priceCache
          ├─ evaluatePositionLimit(config, 'AAPL', positions)
          └─ evaluateCooldown(config, botId, 'AAPL') → DB query for recent fills

All rules pass:
  └─ prisma.execution.create({ status:'queued', origin:'bot', botId, clientOrderId, activeIntentKey, ... })
  └─ inflightMap.set('bot_123:AAPL', true)   ← guard future ticks immediately
  └─ prisma.botEvent.create({ type:'execution_created', ... })

Order Worker picks it up (same flow as manual order from here):
  └─ claim → submit → pollUntilFilled → terminate('filled')
       └─ inflightMap.delete('bot_123:AAPL')  ← clears guard so next tick can fire
```

**Rule short-circuit**: The pipeline iterates `bot.rules` in DB insertion order. The first rule that returns `{ pass: false }` stops evaluation and logs a `BotEvent(execution_skipped)`. No execution is created.

**Tick rate vs. evaluation rate**: Alpaca can fire quotes multiple times per second per ticker. Each tick triggers `evaluateBot` for every bot watching that ticker. The `inflightMap` check is the first line of `evaluateBot` — it's a single `Map.get()` with no DB hit. This means a bot with an open order absorbs zero DB load per tick.

---

## Execution State Machine

```
                    ┌──────────┐
                    │  queued  │  ← created by API server or bot engine
                    └────┬─────┘
                         │ worker claims row
                         ▼
                  ┌─────────────┐
                  │ processing  │  lockedAt set, lockedBy = workerId
                  └──────┬──────┘
                         │
             ┌───────────┼────────────────┐
             │           │                │
             ▼           ▼                ▼
    ┌──────────────┐  ┌────────┐  ┌───────────────┐
    │partially_fill│  │ filled │  │   cancelled   │
    │  (interim)   │  │        │  │               │
    └──────┬───────┘  └────────┘  └───────────────┘
           │ keep polling              ▲
           └───────────────────────────┘
                                  ┌──────────┐
                                  │  failed  │  ← max_attempts_exceeded
                                  └──────────┘
```

| Status | Terminal | Meaning |
|---|---|---|
| `queued` | No | Waiting to be claimed by a worker; `clientOrderId` is already assigned |
| `processing` | No | Claimed by a worker; submission or reconciliation is in progress |
| `submitted` | No | Order accepted by Alpaca; worker reconciles by `brokerOrderId` or `clientOrderId` |
| `partially_filled` | No | Alpaca has filled some shares; worker continues polling |
| `filled` | Yes | All shares filled; `filledPrice`, `filledQuantity`, `filledAt` populated |
| `cancelled` | Yes | Broker rejected, no broker account found, or broker cancelled the order |
| `failed` | Yes | Exhausted `MAX_ATTEMPTS` (3) after network errors |

**`partially_filled` is not terminal.** The worker continues polling until the order reaches `filled`, `canceled`, `rejected`, or `expired` at the broker level, or until the 30-second fill timeout triggers a `releaseForRetry`.

**Stuck-job recovery**: A background sweep runs every 60 seconds. Any row with `status in ('processing','submitted','partially_filled')` and `lockedAt < now - 2 minutes` is reset to `queued` with `lockedAt = null`. On retry, the worker reconciles by `clientOrderId` before any new submit.

---

## Bot Engine Deep Dive

**File**: `engine/botEngine.js`

### In-memory state

```
botRegistry  Map<botId, Bot>          — full bot + rules loaded from DB
tickerIndex  Map<ticker, Set<botId>>  — reverse index for O(1) tick routing
inflightMap  Map<"botId:ticker", true> — guard: skip evaluation if order pending
positionCacheByUser  Map<userId, { positions, updatedAt }> — LRU, max 500 users
```

### Bot registry reload (`reloadBots`, every 3 seconds)

1. Query all enabled, non-deleted bots with their enabled rules
2. Rebuild `botRegistry` and `newTickerIndex` from scratch
3. Compute ticker delta against `previousTickers` using explicit `for...of` loops
4. Call `subscribe(toAdd)` / `unsubscribe(toRemove)` — **delta only**, never full list
5. Update `previousTickers`

The 3-second reload means new bots are live within 3 seconds of creation. Deleted or disabled bots stop being evaluated on the next reload cycle.

### Startup: `initInflightMap`

On `startBotEngine()`, before the reload timer starts, all active bot executions (`queued`, `processing`, `submitted`, `partially_filled`) are fetched from DB and pre-loaded into `inflightMap`. This eliminates the cold-start DB fallback check on the first tick after a restart.

### Position cache (LRU)

`positionCacheByUser` is a `Map` used as an LRU cache. JavaScript `Map` preserves insertion order. On each write:

```js
positionCacheByUser.delete(userId)   // remove (if present) to move to end on re-insert
positionCacheByUser.set(userId, ...)  // insert at end = most recently used
if (size > 500) delete first key      // evict least recently used
```

Positions are refreshed from Alpaca REST every 60 seconds per user. On Alpaca error, stale positions are returned rather than failing rule evaluation.

---

## Rule Evaluators

All rule evaluators live in `engine/rules/`. Each exports a single function and returns `{ pass: boolean, reason?: string, detail?: string }`.

### `market_hours`
```
config: { allowPremarket?: boolean, allowAfterHours?: boolean }
```
Reads `getMarketHours()` from `calendar.js` (populated once at startup). Synchronous — no DB or network.

### `price_threshold`
```
config: { operator: 'above' | 'below', price: number }
```
Reads `priceCache`. Returns `{ pass: false, reason: 'stale_price_data', stale: true }` if the cached quote is older than 5 seconds. Synchronous — no DB or network.

### `position_limit`
```
config: { maxQuantity: number }
```
Receives the pre-fetched `positions` array from `getPositions(userId)`. Finds the matching ticker and checks `qty >= maxQuantity`. Synchronous after the position fetch.

### `cooldown`
```
config: { minutes: number }
```
DB query: `findFirst` for a `filled` execution for this `botId + ticker` within the cooldown window. Returns `detail` string showing how many minutes ago the last fill was.

### `daily_loss`
```
config: { maxLoss: number }  — positive dollar amount
```
DB aggregate: all `filled` executions for this `portfolioId` since midnight. Computes realized P&L as `sells - buys`. Blocks if the loss exceeds `maxLoss`.

**Rule pipeline contract**: Any evaluator that returns `{ pass: false }` causes `evaluateBot` to log a `BotEvent(execution_skipped)` and return without creating an execution. Rules are evaluated in the order they appear in `bot.rules`.

---

## Order Worker Deep Dive

**File**: `queues/orderWorker.js`

### The claim loop

```js
while (running) {
  const job = await claimNextExecution()
  if (!job) {
    await sleep(500)    // idle: nothing queued
    continue
  }
  await processExecution(job)  // no sleep: process immediately
}
```

Adaptive polling: when work is available, the loop runs as fast as the DB and Alpaca allow. When the queue is empty, it backs off to 500ms.

### Two-step optimistic claim

```js
// Step 1: find
const job = await prisma.execution.findFirst({
  where: { status: 'queued', lockedAt: null },
  orderBy: { createdAt: 'asc' }
})

// Step 2: claim (atomic — WHERE predicate repeated exactly)
const claimed = await prisma.execution.updateMany({
  where: { id: job.id, status: 'queued', lockedAt: null },
  data:  { status: 'processing', lockedAt: new Date(), lockedBy: WORKER_ID }
})
if (claimed.count === 0) return null  // lost the race to another worker
```

If a second worker claims the same row between step 1 and step 2, `updateMany` finds no matching row and returns `count: 0`. The losing worker simply moves on.

### Idempotency key

`clientOrderId` is persisted on the `Execution` row before any broker call. The worker reconciles by `clientOrderId` first, then writes `brokerOrderId` after Alpaca acknowledges the order:

```
persist intent → DB row has clientOrderId = 'tp_exe_...'
submit/reconcile → Alpaca returns { id: 'abc-123', client_order_id: 'tp_exe_...' }
  └─ prisma.execution.update({ brokerOrderId: 'abc-123', clientOrderId: 'tp_exe_...', submittedAt: now, status: 'submitted' })
       └─ pollUntilFilled(...)
```

If the worker crashes after Alpaca accepted the order but before `brokerOrderId` was written locally, the stuck-job recovery resets the row to `queued`. On retry, the worker first checks Alpaca by `clientOrderId` and resumes polling the existing order instead of blindly re-submitting.

If the worker crashes after `brokerOrderId` is written, on retry it checks:

```js
if (execution.brokerOrderId) {
  await syncOrderStatus(execution, broker)  // polls for existing order instead of re-submitting
  return
}
```

### Error handling

| Error type | Action |
|---|---|
| `BrokerRejectionError` (4xx) | `terminate('cancelled', err.reason)` — not retried |
| `BrokerNetworkError` (5xx, timeout) | `releaseForRetry` — back to `queued` for next attempt |
| Unexpected error | `releaseForRetry` |
| `attempts >= 3` | `terminate('failed', 'max_attempts_exceeded')` |

---

## Multi-Tenant Isolation

Multiple users can have active bots simultaneously. Each user has their own Alpaca account (`BrokerAccount` table). Isolation is enforced at three points:

### 1. Per-user broker client (`broker/clientCache.js`)

```js
// Map<userId, { client: AlpacaClient, updatedAt: Date }>
```

Every call to `getBrokerClient(userId)` loads that user's credentials from `BrokerAccount` and compares `account.updatedAt` against the cached `updatedAt`. If credentials were rotated, a new client is built automatically. User A's client is **never** used to place User B's order.

### 2. Per-user position cache (`engine/botEngine.js`)

```js
// Map<userId, { positions: [], updatedAt: number }>
```

`getPositions(userId)` fetches from `userId`'s own Alpaca account via `getBrokerClient(userId)`. The cache is keyed by `userId` — User A's position array is never consulted when evaluating User B's bot.

### 3. Execution carries `userId`

The `Execution` row stores `userId`. The order worker reads `execution.userId` to obtain the correct broker client. Even if bot evaluation data leaked across users (it can't), the order would still be submitted through the correct account.

### Live trading guard

`AlpacaClient` constructor checks:

```js
if (!paper && process.env.ALLOW_LIVE_TRADING !== 'true') {
  throw new Error('Live trading is disabled. Set ALLOW_LIVE_TRADING=true to enable.')
}
```

The default environment has `paper: true` and this guard prevents any accidental live order submission.

---

## Market Data Layer

### Data stream (`market/dataStream.js`)

A single Alpaca WebSocket connection serves the entire worker process regardless of how many users or bots are active. The stream is market-level, not account-specific.

**Subscription management**: the bot engine calls `subscribe(tickers[])` / `unsubscribe(tickers[])` with deltas only. The stream tracks `currentTickers` internally to re-subscribe on reconnection.

```
onStockQuote → priceCache.set(ticker, { bid, ask, last, updatedAt })
             → quoteHandler(ticker)  [→ botEngine.onPriceTick]

onStockBar   → priceCache.updateLast(ticker, bar.c)  [in-place mutation, no allocation]
             → barHandler(ticker, bar)  [optional]
```

### Price cache (`market/priceCache.js`)

```
priceCache.set(ticker, quote)        — full write, sets updatedAt
priceCache.get(ticker)               — returns cached entry or null
priceCache.isStale(ticker, maxAgeMs) — true if updatedAt > 5s ago (default)
priceCache.updateLast(ticker, last)  — in-place mutation for bar updates
priceCache.tickers()                 — all currently cached tickers
```

Staleness is checked in `evaluatePriceThreshold` before reading `quote.last`. A stale quote returns `{ pass: false, reason: 'stale_price_data' }` rather than trading on an outdated price.

### Calendar (`market/calendar.js`)

On startup, `initCalendar(broker)` fetches the Alpaca market clock and today's calendar entry. It returns:

```js
{ isOpen, marketOpen: Date, marketClose: Date, msUntilOpen, msUntilClose }
```

`getMarketHours()` is synchronous and readable from any rule evaluator without a network call. `onMarketOpen(ms, cb)` and `onMarketClose(ms, cb)` schedule `setTimeout` callbacks to start and stop the bot engine.

---

## File Reference

```
worker/
├── src/
│   ├── worker.js                    Bootstrap — wires all layers, heartbeat, graceful shutdown
│   ├── db/
│   │   └── prisma.js                Shared Prisma client
│   ├── broker/
│   │   ├── alpacaClient.js          AlpacaClient wrapper + BrokerNetworkError / BrokerRejectionError
│   │   └── clientCache.js           Per-user AlpacaClient cache with updatedAt invalidation
│   ├── market/
│   │   ├── dataStream.js            Single Alpaca WebSocket, subscribe/unsubscribe deltas
│   │   ├── priceCache.js            In-memory ticker → { bid, ask, last, updatedAt }
│   │   └── calendar.js              Market clock, open/close scheduling
│   ├── engine/
│   │   ├── botEngine.js             Bot registry reload, tick routing, rule pipeline, execution creation
│   │   └── rules/
│   │       ├── marketHours.js       Synchronous — reads calendar state
│   │       ├── priceThreshold.js    Synchronous — reads priceCache
│   │       ├── positionLimit.js     Synchronous — reads pre-fetched positions array
│   │       ├── cooldown.js          Async — DB query for recent fills
│   │       └── dailyLoss.js         Async — DB aggregate of today's filled executions
│   └── queues/
│       └── orderWorker.js           Claim loop, optimistic locking, Alpaca submit, fill polling
├── package.json                     Points prisma schema at ../server/prisma/schema.prisma
└── WORKER.md                        This file
```

---

## Adding a New Rule Type

1. **Create the evaluator** in `engine/rules/`:

```js
// engine/rules/myRule.js
// config: { myParam: number }
export function evaluateMyRule(config, ...args) {
  if (someCondition) {
    return { pass: false, reason: 'my_reason', detail: 'human-readable explanation' }
  }
  return { pass: true }
}
```

   - Return `{ pass: true }` to allow execution.
   - Return `{ pass: false, reason: string }` to block it.
   - `detail` is optional human-readable context logged to `BotEvent.metadata`.
   - Async is fine — `evaluateRule` is `await`ed.

2. **Add the `case`** in `botEngine.js`:

```js
case 'my_rule':
  return evaluateMyRule(rule.config, /* ticker, positions, etc. */)
```

3. **Add to the Prisma enum** in `server/prisma/schema.prisma`:

```prisma
enum BotRuleType {
  ...
  my_rule
}
```

   Then run `npx prisma db push` in `server/`.

4. **Add to the route validation enum** in `server/src/routes/bots/rules.js`:

```js
enum: ['price_threshold', ..., 'my_rule']
```

5. **Add a template** (optional) in `server/prisma/seeds/bot-templates.json` and re-run `npm run db:seed` in `server/`.

That's the complete surface area for a new rule. The worker picks it up on the next `reloadBots` cycle (within 3 seconds) — no restart required.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | MySQL connection string (`mysql://user:pass@host:3306/db`) |
| `ALLOW_LIVE_TRADING` | No | `false` | Set to `true` to allow non-paper Alpaca accounts |

The worker reads `BrokerAccount` credentials from the database at runtime. API keys are never in environment variables.
