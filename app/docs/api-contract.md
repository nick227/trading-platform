# API Contract - Canonical Schema

This document defines the complete API contract that both frontend and backend will implement. All field names, types, and behaviors are locked.

## ID Format Convention

**Format**: `{prefix}_{timestamp}_{random4}`  
**Examples**: `prd_1713347535000_a1b2`, `exe_1713347700000_c3d4`, `str_1713347800000_e5f6`, `prt_1713347900000_g7h8`, `bot_1713348000000_i9j0`

**Prefixes**:
- `prd_` - Prediction
- `exe_` - Execution  
- `str_` - Strategy
- `prt_` - Portfolio
- `bot_` - Bot
- `evt_` - BotEvent
- `rul_` - BotRule

**Note**: Positions are computed and never stored, so they don't have IDs. Ticker is the natural key within a portfolio.

**Benefits**: Contextual identification without additional lookups.

## Field Naming Convention

**Price fields**: Verbose format (`entryPrice`, `stopPrice`, `targetPrice`)  
**Rationale**: Explicit naming avoids ambiguity with `fillPrice`, `currentPrice`, `executionPrice`.

## Resource Schemas

### Strategy
```typescript
interface Strategy {
  id: string           // str_*
  name: string
  description: string
  type: string
  // Note: layer is internal, not exposed
}
```

### Prediction
```typescript
interface Prediction {
  id: string           // prd_*
  strategyId: string   // str_*
  ticker: string
  direction: 'buy' | 'sell'  // Model's directional prediction
  confidence: number   // 0-1
  entryPrice: number
  stopPrice: number
  targetPrice: number
  createdAt: number    // epoch ms
  regime: string       // Market context/conditions
  reasoning: string    // Model explanation
  // Note: executed is derived client-side
}
```

### Execution
```typescript
interface Execution {
  id: string           // exe_*
  portfolioId: string  // prt_*
  strategyId: string   // str_*
  predictionId: string | null  // prd_*, nullable
  botId: string | null    // bot_*, nullable
  ticker: string
  direction: 'buy' | 'sell'  // renamed from side
  quantity: number
  price: number
  createdAt: number    // epoch ms
  status: 'filled' | 'proposed' | 'cancelled'
  commission: number
  fees: number
  // Note: netValue = (quantity * price) + commission + fees (derived)
}
```

### Position
```typescript
interface Position {
  ticker: string
  quantity: number
  avgCost: number
  totalCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnL: number
  unrealizedPnLPct: number
  // Note: Always computed from executions, never stored
}
```

### Portfolio
```typescript
interface Portfolio {
  id: string           // prt_*
  name: string
  createdAt: number    // epoch ms
}
```

### Bot
```typescript
interface Bot {
  id: string           // bot_*
  portfolioId: string  // prt_*
  strategyId: string   // str_*
  name: string
  enabled: boolean
  config: {
    maxPositionSize?: number
    maxDailyLoss?: number
    allowedTickers?: string[] | null
  }
  createdAt: number    // epoch ms
  updatedAt: number    // epoch ms
}
```

### BotEvent
```typescript
interface BotEvent {
  id: string           // evt_*
  botId: string        // bot_*
  portfolioId: string  // prt_*
  ruleId: string | null
  executionId: string | null  // exe_*
  type: 'rule_triggered' | 'decision_made' | 'execution_created' | 'execution_skipped' | 'error_occurred'
  detail: string       // Human-readable explanation
  metadata: Record<string, any> | null  // Structured machine-readable context
  createdAt: number    // epoch ms
}
```

### BotRule
```typescript
interface BotRule {
  id: string           // rul_*
  botId: string        // bot_*
  name: string
  type: 'price_threshold' | 'position_limit' | 'daily_loss' | 'market_hours'
  config: {
    // price_threshold
    ticker: string
    threshold: number
    direction: 'above' | 'below'
  } | {
    // position_limit
    maxPositionSize: number
  } | {
    // daily_loss
    maxDailyLoss: number
  } | {
    // market_hours
    marketHours: 'pre' | 'regular' | 'after'
  }
  enabled: boolean
  createdAt: number    // epoch ms
  updatedAt: number    // epoch ms
}
```

### Portfolio Summary
```typescript
interface PortfolioSummary {
  totalValue: number
  totalPnL: number
  totalPnLPct: number
  positions: number
  topPosition: string | null
  topPositionValue: number
}
```

### Executions Summary
```typescript
interface ExecutionsSummary {
  totalExecutions: number
  buyExecutions: number
  sellExecutions: number
  winRate: number        // wins / total sells
  totalVolume: number
  avgExecutionSize: number
  latestExecution: Execution | null
  oldestExecution: Execution | null
}
```

**Win Rate Definition**:
- **Win**: Sell execution where sellPrice > avgCost at time of sell
- **Avg Cost**: Weighted average of all buy executions for that ticker up to sell time
- **Win Rate**: (number of winning sells) / (total number of sell executions)

## Endpoints & Query Parameters

### Strategies
```
GET /api/strategies
GET /api/strategies/:id
```
**Query Parameters**: None (no filtering)

### Predictions
```
GET /api/predictions
GET /api/predictions/:id
```
**Query Parameters**:
- `strategyId` (string) - Filter by strategy
- `ticker` (string) - Filter by ticker
- `direction` ('buy' | 'sell') - Filter by prediction direction
- `regime` (string) - Filter by market regime
- `dateFrom` (number) - Filter from date (epoch ms)
- `dateTo` (number) - Filter to date (epoch ms)
- `limit` (number) - Pagination limit (default: 50, max: 100)
- `offset` (number) - Pagination offset (default: 0)

**Pagination**: Offset-based
**Default Sorting**: `createdAt` descending

### Executions
```
GET /api/executions
GET /api/executions/:id
POST /api/executions
GET /api/executions/summary
```
**Query Parameters (GET /api/executions)**:
- `portfolioId` (string) - Filter by portfolio
- `strategyId` (string) - Filter by strategy
- `ticker` (string) - Filter by ticker
- `direction` ('buy' | 'sell') - Filter by direction
- `status` ('filled' | 'proposed' | 'cancelled') - Filter by status
- `dateFrom` (number) - Filter from date (epoch ms)
- `dateTo` (number) - Filter to date (epoch ms)
- `after` (string) - Cursor pagination: get executions with (createdAt, id) < (cursor.createdAt, cursor.id)
- `limit` (number) - Pagination limit (default: 50, max: 100)

**Pagination**: Cursor-based using `after` parameter for append-only log
**Default Sorting**: `createdAt` descending
**Cursor Behavior**: 
- `after` returns executions with (createdAt, id) < (cursor.createdAt, cursor.id)
- Cursor = last item's (createdAt, id) from previous page
- Sort order: (createdAt DESC, id DESC) for strict ordering
- Prevents duplicates/skips when multiple executions share same createdAt
**Routing Note**: `/summary` route must be defined before `/:id` route

**Query Parameters (GET /api/executions/summary)**:
- `portfolioId` (string) - Filter by portfolio (optional)
- `strategyId` (string) - Filter by strategy (optional)
- `dateFrom` (number) - Filter from date (epoch ms, optional)
- `dateTo` (number) - Filter to date (epoch ms, optional)

**POST Body**:
```typescript
{
  ticker: string
  direction: 'buy' | 'sell'
  quantity: number
  price: number
  portfolioId: string
  strategyId: string
  predictionId?: string  // optional
  botId?: string       // optional
}
```

### Bots
```
GET /api/bots
GET /api/bots/:id
POST /api/bots
PATCH /api/bots/:id
DELETE /api/bots/:id
```
**Query Parameters (GET /api/bots)**:
- `portfolioId` (string) - Filter by portfolio
- `strategyId` (string) - Filter by strategy
- `enabled` (boolean) - Filter by enabled status
- `dateFrom` (number) - Filter from date (epoch ms)
- `dateTo` (number) - Filter to date (epoch ms)
- `limit` (number) - Pagination limit (default: 50, max: 100)
- `offset` (number) - Pagination offset (default: 0)

**Pagination**: Offset-based
**Default Sorting**: `createdAt` descending

**POST Body**:
```typescript
{
  name: string
  portfolioId: string
  strategyId: string
  enabled: boolean
  config?: {
    maxPositionSize?: number
    maxDailyLoss?: number
    allowedTickers?: string[] | null
  }
}
```

**PATCH Body**:
```typescript
{
  enabled?: boolean
  config?: {
    maxPositionSize?: number
    maxDailyLoss?: number
    allowedTickers?: string[] | null
  }
}
```

### Bot Rules
```
GET /api/bots/:id/rules
GET /api/bots/:id/rules/:ruleId
POST /api/bots/:id/rules
PATCH /api/bots/:id/rules/:ruleId
DELETE /api/bots/:id/rules/:ruleId
```
**Query Parameters (GET /api/bots/:id/rules)**:
- `type` (string) - Filter by rule type
- `enabled` (boolean) - Filter by enabled status
- `limit` (number) - Pagination limit (default: 50, max: 100)
- `offset` (number) - Pagination offset (default: 0)

**POST Body**:
```typescript
{
  name: string
  type: 'price_threshold' | 'position_limit' | 'daily_loss' | 'market_hours'
  config: {
    // price_threshold
    ticker: string
    threshold: number
    direction: 'above' | 'below'
  } | {
    // position_limit
    maxPositionSize: number
  } | {
    // daily_loss
    maxDailyLoss: number
  } | {
    // market_hours
    marketHours: 'pre' | 'regular' | 'after'
  }
  enabled: boolean
}
```

**PATCH Body**:
```typescript
{
  enabled?: boolean
  config?: {
    // price_threshold
    ticker: string
    threshold: number
    direction: 'above' | 'below'
  } | {
    // position_limit
    maxPositionSize: number
  } | {
    // daily_loss
    maxDailyLoss: number
  } | {
    // market_hours
    marketHours: 'pre' | 'regular' | 'after'
  }
}
```

### Bot Events
```
GET /api/bots/:id/events
GET /api/bots/:id/events/:eventId
```
**Query Parameters (GET /api/bots/:id/events)**:
- `type` (string) - Filter by event type
- `ruleId` (string) - Filter by rule
- `dateFrom` (number) - Filter from date (epoch ms)
- `dateTo` (number) - Filter to date (epoch ms)
- `after` (string) - Cursor pagination: get events with (createdAt, id) < (cursor.createdAt, cursor.id)
- `limit` (number) - Pagination limit (default: 50, max: 100)

**Pagination**: Cursor-based using `after` parameter for append-only log
**Default Sorting**: `createdAt` descending
**Cursor Behavior**: 
- `after` returns events with (createdAt, id) < (cursor.createdAt, cursor.id)
- Cursor = last item's (createdAt, id) from previous page
- Sort order: (createdAt DESC, id DESC) for strict ordering

### Portfolios
```
GET /api/portfolios
GET /api/portfolios/:id
POST /api/portfolios
GET /api/portfolios/:id/positions
GET /api/portfolios/:id/summary
```
**Query Parameters (GET /api/portfolios)**:
- `dateFrom` (number) - Filter from date (epoch ms)
- `dateTo` (number) - Filter to date (epoch ms)
- `limit` (number) - Pagination limit (default: 50, max: 100)
- `offset` (number) - Pagination offset (default: 0)

**Query Parameters (GET /api/portfolios/:id/positions)**: None

**Query Parameters (GET /api/portfolios/:id/summary)**: None

**Pagination**: Offset-based (portfolios list only)
**Default Sorting**: `createdAt` descending

**POST Body**:
```typescript
{
  name: string
}
```

## Nullability Rules

**Nullable Fields**:
- `Execution.predictionId` - Manual trades may not have source prediction
- `Execution.botId` - Manual trades may not have bot source

**Non-Nullable Fields**:
- All other fields are required unless explicitly marked optional

**Optional Fields**:
- `Execution.predictionId` in POST body (manual trades)
- `Execution.botId` in POST body (manual trades)
- `Bot.config` fields in POST body (optional configuration)

## Response Format

**Success Response**:
```json
{
  "data": <resource | resource[]>,
  "pagination": {
    "limit": number,
    "hasMore": boolean,
    "nextCursor": "exe_1713347700000" // cursor-based (executions)
  }
}
```

**Offset Pagination Response** (portfolios, opportunities):
```json
{
  "data": <resource | resource[]>,
  "pagination": {
    "limit": number,
    "offset": number,
    "total": number,
    "hasMore": boolean
  }
}
```

**Error Response**:
```json
{
  "error": {
    "code": string,
    "message": string,
    "details": any
  }
}
```

## Derived State Rules

**Client-Side Derivations**:
- `Prediction.executed` = `executions.some(e => e.predictionId === prediction.id)`

**Server-Side Computations**:
- `Position` objects computed from executions using FIFO
- `PortfolioSummary` computed from positions
- `ExecutionsSummary` computed from executions

## Validation Rules

**Prediction**:
- `confidence`: 0-1 inclusive
- `direction`: 'buy' | 'sell'

**Execution**:
- `quantity`: > 0
- `price`: > 0
- `direction`: 'buy' | 'sell'
- `status`: 'filled' | 'proposed' | 'cancelled'

**Portfolio**:
- `name`: non-empty string

## Business Rules

**FIFO Cost Basis**:
- Positions computed using First-In, First-Out cost basis
- Edge case: Cannot sell more shares than owned (throw error)

**Execution Rules**:
- Executions are immutable (append-only)
- No update/delete operations
- Status transitions: proposed -> filled | cancelled

**Prediction Rules**:
- Predictions are immutable once generated
- No status lifecycle - predictions are factual model outputs
- Regime field provides market context for prediction validity

**Bot Rules**:
- DELETE is soft delete (marks as deleted, does not remove from DB)
- Deleted bots remain referenceable on executions for audit purposes
- Bots can be disabled via PATCH without deletion

**BotEvent Rules**:
- Events are append-only (no updates/deletes)
- Events reference executions, not the reverse
- Execution remains clean financial record (no event linkage back)
- metadata stored as JSON string in DB, parsed in service layer

**BotEvent Metadata Examples**:
```typescript
// rule_triggered
{ ticker: "NVDA", threshold: 180, actualPrice: 179.50, ruleId: "rul_..." }

// decision_made
{ confidence: 0.85, modelVersion: "v2.1", regime: "bullish", strategyId: "str_..." }

// execution_created
{ executionId: "exe_...", quantity: 100, price: 179.50, direction: "buy" }

// execution_skipped
{ reason: "position_limit" | "daily_loss_limit" | "market_closed" }

// error_occurred
{ code: "BROKER_ERROR", message: "Order rejected", stack: "..." }
```

## Implementation Notes

**Timestamp Format**: All timestamps are epoch milliseconds (number)

**Price Precision**: Use standard number precision (no enforced decimal places)

**ID Generation**: Backend generates IDs using `{prefix}_{timestamp}_{random4}` format to prevent collisions

**Error Codes**: Standard HTTP status codes with application-specific error codes

**Rate Limiting**: Apply to all endpoints (configurable per endpoint)

**Authentication**: JWT-based authentication (implementation-specific)

**Pagination Strategy**:
- Executions: Cursor-based using `after` parameter (append-only log)
- BotEvents: Cursor-based using `after` parameter (append-only log)
- Portfolios: Offset-based using `limit`/`offset` (rarely changes)
- Predictions: Offset-based using `limit`/`offset`
- Bots: Offset-based using `limit`/`offset`
- BotRules: Offset-based using `limit`/`offset`

**Routing Priority**:
- `/api/executions/summary` must be defined before `/api/executions/:id`
- All specific routes before parameterized routes

**Frontend Migration Notes**:
- Old `opportunities` endpoints renamed to `predictions`
- Old `opportunityId` field renamed to `predictionId`
- Remove opportunity status lifecycle logic (predictions are immutable)
- Cursor pagination for executions requires different handling than offset

**Architectural Clarity**:
- `prediction`: What the system believes (model output)
- `execution`: What actually happened (trade record)
- `position`: Where you stand (derived state)
- `bot`: Stateful execution policy applied to strategy
- `botRule`: Trigger conditions for bot actions
- `botEvent`: Audit trail of bot decisions and actions

**Clean Mental Model**:
strategies -> generate predictions
bots -> apply execution policies
rules -> define trigger conditions
events -> audit decisions and actions
executions -> record financial truth
positions -> derived state

**Bot Observability Surface**:
- `GET /api/bots/:id/rules` - What it watches
- `GET /api/bots/:id/events` - What it did and why
- `GET /api/executions?botId=` - Financial truth

**Clean API Surface**:
```
GET    /api/strategies
GET    /api/predictions
GET    /api/predictions/:id
GET    /api/bots
GET    /api/bots/:id
POST   /api/bots
PATCH  /api/bots/:id
DELETE /api/bots/:id
GET    /api/bots/:id/rules
GET    /api/bots/:id/rules/:ruleId
POST   /api/bots/:id/rules
PATCH  /api/bots/:id/rules/:ruleId
DELETE /api/bots/:id/rules/:ruleId
GET    /api/bots/:id/events
GET    /api/bots/:id/events/:eventId
GET    /api/executions
POST   /api/executions
GET    /api/portfolios
GET    /api/portfolios/:id
GET    /api/portfolios/:id/positions
```

## Decision Log

**Predictions not Opportunities**
- **Why**: "Opportunities" implies human-facing concepts with lifecycle management
- **Reality**: Predictions are immutable model outputs, which is what the engine actually produces
- **Benefit**: No artificial status management, predictions are factual records

**Direction not Side or Type**
- **Why**: "Side" implies action, "Type" is generic
- **Reality**: "Direction" is neutral across both prediction and execution layers
- **Benefit**: Consistent vocabulary that doesn't imply action vs forecast

**Executed Derived not Stored**
- **Why**: Storing execution state creates a second source of truth that can drift
- **Reality**: Deriving from execution log means it can never go out of sync
- **Benefit**: Single source of truth, always accurate by definition

**Cursor Pagination on Executions, Offset on Others**
- **Why**: Executions are append-only and high-frequency, offset pagination causes page drift
- **Reality**: Portfolios, predictions, bots change slowly enough for offset to be fine
- **Benefit**: No missing/duplicate data on high-frequency execution feeds

**BotId Nullable on Execution**
- **Why**: Manual trades are first-class, not an edge case
- **Reality**: System should work without bots as primary use case
- **Benefit**: Clear distinction between manual and automated trades

**Positions Never Stored**
- **Why**: Storing positions would require reconciliation processes
- **Reality**: Positions are pure function of execution log
- **Benefit**: Always correct by definition, no sync issues

**Bot DELETE is Soft**
- **Why**: Bots that generated executions need to stay referenceable for audit
- **Reality**: Hard delete would orphan execution records
- **Benefit**: Complete audit trail preserved

**BotEvent.portfolioId Denormalized**
- **Why**: Avoids join through bot for portfolio-scoped event queries
- **Reality**: portfolioId on BotEvent always equals bot.portfolioId
- **Constraint**: Must be set from bot.portfolioId at event creation time, never independently
- **Benefit**: Faster queries, no expensive joins at scale

---

**This document is the single source of truth for API implementation. Both frontend and backend must implement exactly as specified.**
