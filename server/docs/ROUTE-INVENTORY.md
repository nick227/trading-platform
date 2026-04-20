# Route Inventory (Server)

This document lists the HTTP routes that are currently mounted by the Fastify server.

Source of truth for what is mounted: `src/loaders/routes.js`.

## Non-API Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/docs` | Swagger UI (see `src/loaders/fastify.js`). |

## API Routes (Mounted)

Base prefix: `/api`

### Auth (`/api/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | No | Body: `email`, `password`, `fullName`. Creates user + trial subscription. |
| POST | `/api/auth/login` | No | Body: `email`, `password`. Sets `access_token` httpOnly cookie. |
| POST | `/api/auth/logout` | No | Clears `access_token` cookie. |
| GET | `/api/auth/me` | Yes | Reads current user from cookie JWT (middleware `authenticate`). |

### Strategies (`/api/strategies`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/strategies` | Query passthrough to service (filtering/pagination may apply). |
| GET | `/api/strategies/:id` | 404 when not found. |
| POST | `/api/strategies` | Body: `name`, `type`, optional `description`. |
| PUT | `/api/strategies/:id` | Body: `name?`, `type?`, `description?`. 404 when not found. |
| DELETE | `/api/strategies/:id` | 204 on success. 400 if dependencies prevent deletion. |

### Predictions (`/api/predictions`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/predictions` | Query passthrough to service (filtering/pagination may apply). |
| GET | `/api/predictions/:id` | 404 when not found. |

### Bots (CRUD) (`/api/bots`)

Currently mounted bots routes are limited to CRUD from `src/routes/bots/bots.js`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bots` | Query passthrough to service (filtering/pagination may apply). |
| GET | `/api/bots/:id` | 404 when not found. |
| POST | `/api/bots` | Body: `name`, `portfolioId`, optional `strategyId`, `botType`, `enabled`, `config`, `userId`. |
| PUT | `/api/bots/:id` | Body: `name?`, `enabled?`, `config?`. 404 when not found. |
| DELETE | `/api/bots/:id` | 204 on success. 404 when not found. |

### Operator Bot (`/api/bot`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bot/status` | Returns bot runtime status. |
| GET | `/api/bot/current-signal` | Returns top Alpha Engine signal + explainability (if available). |
| POST | `/api/bot/start` | Starts bot runner. |
| POST | `/api/bot/stop` | Stops bot runner. |
| POST | `/api/bot/run-once` | Attempts to execute one trade from current signal. |
| GET | `/api/bot/runs` | Returns recent bot runs (currently `limit=20`). |

### Executions (`/api/executions`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/executions/summary` | Must be registered before `/:id` (already done). Query passthrough to service. |
| GET | `/api/executions` | Query passthrough to service (filtering/pagination may apply). |
| GET | `/api/executions/:id` | 404 when not found. |
| POST | `/api/executions` | Body: `userId`, `ticker`, `direction` (`buy`/`sell`), `quantity`, `price`, `portfolioId`, optional `strategyId`, `predictionId`, `botId`. |

### Portfolios (`/api/portfolios`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/portfolios/default` | Returns or creates the operator portfolio. |
| GET | `/api/portfolios` | Query passthrough to service (filtering/pagination may apply). |
| GET | `/api/portfolios/:id` | 404 when not found. |
| POST | `/api/portfolios` | Body: `name`, optional `userId`. |
| PUT | `/api/portfolios/:id` | Body: `name?`. 404 when not found. |
| DELETE | `/api/portfolios/:id` | 204 on success. 400 if dependencies prevent deletion. |

### Broker Accounts (`/api/broker`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/broker` | Body: `userId`, `apiKey`, `apiSecret`, optional `paper`. Returns masked secrets. |
| GET | `/api/broker/:userId` | Returns masked account. 404 when missing. |
| DELETE | `/api/broker/:userId` | Deletes account. 404 when missing. |

### Ops (`/api/ops`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/ops/overview` | Operational overview. |
| GET | `/api/ops/audits` | Query passthrough to service. |

### Engine (`/api/engine`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/engine/health` | 503 when engine is unavailable. |
| GET | `/api/engine/rankings/top` | Query: `limit` (default 20). |
| GET | `/api/engine/rankings/movers` | Query: `limit` (default 50). |
| GET | `/api/engine/ticker/:symbol/explainability` | Ticker explainability. |
| GET | `/api/engine/ticker/:symbol/performance` | Query: `window` (default `30d`). |
| GET | `/api/engine/admission/changes` | Query: `hours` (default 24). |
| GET | `/api/engine/dashboard` | Aggregated dashboard data. |
| GET | `/api/engine/signals/active` | Active trading signals. |
| GET | `/api/engine/predictions` | Legacy passthrough via `oldEngineClient`. |
| GET | `/api/engine/strategies` | Legacy passthrough via `oldEngineClient`. |
| GET | `/api/engine/prices/current` | Legacy passthrough via `oldEngineClient`. |

### Alpaca Proxy (`/api/alpaca`)

Requires `ALPACA_API_KEY` and `ALPACA_API_SECRET` env vars; returns 503 when not configured.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/alpaca/order` | Submits an order (market/limit). |
| GET | `/api/alpaca/order/:id` | Fetches order status. |
| DELETE | `/api/alpaca/order/:id` | Cancels order. |
| GET | `/api/alpaca/account` | Returns normalized Alpaca account balances. |
| GET | `/api/alpaca/market-clock` | Returns market open/close timestamps. |

### Performance (`/api/performance`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/performance/stats` | Calculated stats from executions (uses `STUB_USER_ID`). |
| GET | `/api/performance/today` | Intraday stats (uses `STUB_USER_ID`). |
| GET | `/api/performance/daily-snapshots` | Last 30 snapshots. |

### Account (`/api/account`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/account` | Account summary (Alpaca balances + execution PnL). Uses `STUB_USER_ID`. |
| GET | `/api/account/positions` | Derived open positions (FIFO netting). Uses `STUB_USER_ID`. |

### Trade (`/api/trade`)

This route orchestrates an order through the local `/api/alpaca/*` endpoints and persists an execution record.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/trade` | Body: `symbol`, `direction` (`BUY`/`SELL`), `quantity`, `price`. Uses `STUB_USER_ID`. |
| GET | `/api/trade/:id` | Returns execution + (best-effort) Alpaca order status sync. |
| DELETE | `/api/trade/:id` | Cancels a `submitted`/`pending` order with Alpaca. |

## Routes Present In Code But Not Mounted

These route files exist under `src/routes/` but are not registered by `src/loaders/routes.js`:

| File | Notable Paths (as implemented) |
|---|---|
| `src/routes/bots/index.js` | Intended to mount bots + catalog + events + rules under `/api/bots`. |
| `src/routes/bots/catalog.js` | `/api/bots/catalog`, `/api/bots/catalog/:id`, `/api/bots/from-template`. |
| `src/routes/bots/events.js` | `/api/bots/:id/events` (GET), `/api/bots/events` (POST). |
| `src/routes/bots/rules.js` | `/api/bots/rules` CRUD (note: not scoped under a bot id). |
| `src/routes/bots-new.js` | Alternate v2-style bot API under `/api/*` with paths like `/api/bots/catalog`, `/api/bots/:id/rules`, etc. |

