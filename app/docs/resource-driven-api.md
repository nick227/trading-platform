# Resource-Driven API Architecture

## Problem Solved

**Before**: API was domain-biased (BI-driven) instead of resource-driven (REST-driven)
**After**: Clean resource-centric API with no pipeline leakage

## Architecture Summary

**Old Pipeline-Leaking API**:
```
signals → trades → holdings
```

**New Resource-Driven API**:
```
strategies → opportunities → executions → positions
```

## Resource Contracts

### 1. Strategies
**Purpose**: Define trading strategies and control logic
**Endpoints**:
- `GET /api/strategies`
- `GET /api/strategies/:id`

**Schema**:
```javascript
{
  id: 'volatility-breakout',
  name: 'Volatility Breakout',
  description: 'Detects early volatility',
  type: 'volatility_breakout'
  // Note: layer is internal, not exposed
}
```

### 2. Opportunities
**Purpose**: Present trading opportunities (was signals)
**Endpoints**:
- `GET /api/opportunities`
- `GET /api/opportunities/:id`
- `GET /api/opportunities?strategyId=...&ticker=...`

**Schema**:
```javascript
{
  id: 'opportunity-001',
  strategyId: 'volatility-breakout',
  ticker: 'NVDA',
  score: 0.82,
  confidence: 0.84,
  entry: 482.15,
  stop: 458.90,
  target: 545.20,
  createdAt: 1713347535000,
  side: 'buy',  // was type: BUY
  reasoning: 'Early volatility detected with volume spike'
  // Note: executed is derived client-side
}
```

### 3. Executions
**Purpose**: Record immutable trade executions (was trades)
**Endpoints**:
- `GET /api/executions`
- `GET /api/executions/:id`
- `GET /api/executions?portfolioId=...&ticker=...`
- `POST /api/executions` (create)
- `GET /api/executions/summary`

**Schema**:
```javascript
{
  id: 'execution-001',
  portfolioId: 'portfolio-001',
  strategyId: 'volatility-breakout',
  opportunityId: 'opportunity-001',  // nullable, was signalId
  ticker: 'NVDA',
  side: 'buy',  // was type: BUY
  quantity: 10,
  price: 482.50,
  createdAt: 1713347700000,
  status: 'filled',
  commission: 4.95,
  fees: 0.50,
  total: 4829.50
}
```

### 4. Positions
**Purpose**: Computed portfolio positions (was holdings)
**Endpoints**:
- `GET /api/portfolios/:id/positions`  // was holdings
- `GET /api/portfolios/:id/summary`

**Schema** (always computed, never stored):
```javascript
{
  ticker: 'NVDA',
  quantity: 45,
  avgCost: 240.00,
  totalCost: 10800.00,
  currentPrice: 482.50,
  marketValue: 21712.50,
  unrealizedPnL: 10912.50,
  unrealizedPnLPct: 1.01
}
```

### 5. Portfolios
**Purpose**: Minimal portfolio containers
**Endpoints**:
- `GET /api/portfolios`
- `GET /api/portfolios/:id`
- `POST /api/portfolios` (create)

**Schema**:
```javascript
{
  id: 'portfolio-001',
  name: 'Main Portfolio',
  createdAt: 1642249200000
}
```

## Key Improvements

### 1. Resource Naming
- `signals` → `opportunities` (domain concept, not pipeline stage)
- `trades` → `executions` (precise execution record)
- `holdings` → `positions` (standard finance term)
- `type: BUY/SELL` → `side: buy/sell` (consistent field name)

### 2. Pipeline Leakage Removed
- **Layer**: Internal routing detail, removed from public schema
- **Executed**: Derived client-side, never mutated
- **markSignalExecuted**: Anti-REST endpoint, completely removed

### 3. Derived State Pattern
```javascript
// Client-side derivation (always correct)
const executed = executions.some(e => e.opportunityId === opportunity.id)

// Server-side computation (always fresh)
const positions = computePositionsFromExecutions(executions)
```

### 4. Consistent Language
- Lowercase enums: `buy | sell` (not `BUY | SELL`)
- Standard finance terms: `positions` (not `holdings`)
- Resource-centric: `opportunities` (not `signals`)

## Usage Examples

### Get All Opportunities
```javascript
import { opportunities } from '../api'

const latestOpportunities = await opportunities.getOpportunities()
const nvdaOpportunities = await opportunities.getOpportunitiesByTicker('NVDA')
```

### Check Execution Status
```javascript
import { opportunities, executions } from '../api'

const [opps, execs] = await Promise.all([
  opportunities.getOpportunities(),
  executions.getExecutions()
])

// Derived state - never out of sync
const opportunityExecuted = (opportunityId) => 
  execs.some(e => e.opportunityId === opportunityId)
```

### Create Execution
```javascript
import { executions } from '../api'

const newExecution = await executions.createExecution({
  ticker: 'AAPL',
  side: 'buy',
  quantity: 10,
  price: 165.00,
  portfolioId: 'portfolio-001',
  strategyId: 'volatility-breakout',
  opportunityId: 'opportunity-001'  // optional
})
```

### Get Portfolio Positions
```javascript
import { positions } from '../api'

const portfolioPositions = await positions.getPositions('portfolio-001')
const summary = await positions.getPortfolioSummary('portfolio-001')
```

## Benefits

### 1. Consumer Agnostic
- **Frontend**: Clean resource contracts
- **Bots**: Same API, no special treatment
- **Analytics**: Direct access to all resources
- **External Users**: Standard REST interface

### 2. Implementation Flexible
- **Backend**: Can reorganize internal pipeline without breaking clients
- **Frontend**: Independent of internal architecture
- **Testing**: Clear resource boundaries

### 3. Future-Proof
- **Scalability**: Standard REST patterns
- **Extensibility**: Easy to add new resources
- **Maintenance**: Clear separation of concerns

## Migration Path

### For Frontend
```javascript
// Before
import { signals } from '../api'
const executed = signals.markSignalExecuted(id)

// After  
import { opportunities, executions } from '../api'
const executed = executions.some(e => e.opportunityId === id)
```

### For Backend
- Keep internal pipeline (discovery → engine)
- Expose only resource contracts
- Maintain FIFO and immutable patterns

## Final Architecture

```
🎯 Resource-Driven System

strategies → opportunities → executions → positions
     ↓              ↓              ↓
  defines        presents      records     derives
```

**No pipeline leakage. No implementation coupling. Pure resource contracts.**
