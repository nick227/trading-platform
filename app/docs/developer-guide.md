# Developer Guide - Resource-Driven API Layer

## Overview

This guide covers how to use the new resource-driven client-side API layer that provides clean separation between UI components and data sources. The API is designed to be production-ready with seamless migration from mock to live data.

## Quick Start

```javascript
import { strategies, opportunities, executions, positions } from '../api'

// Get all strategies
const allStrategies = await strategies.getStrategies()

// Get current opportunities
const latestOpportunities = await opportunities.getOpportunities()
const nvdaOpportunities = await opportunities.getOpportunitiesByTicker('NVDA')

// Create a new execution
const newExecution = await executions.createExecution({
  ticker: 'AAPL',
  side: 'buy',
  quantity: 10,
  price: 165.00,
  portfolioId: 'portfolio-001',
  strategyId: 'volatility-breakout'
})

// Get portfolio positions
const positions = await positions.getPositions('portfolio-001')
const portfolioSummary = await positions.getPortfolioSummary('portfolio-001')
```

## API Architecture

### Directory Structure
```
src/api/
|--------------------------------------------------------------------------
| index.js              # Main API client entry point
| config.js             # Configuration (mock/live toggle)
| endpoints-new.js       # Resource-driven endpoint definitions
| types.js              # Shared types and validation
| query-params.js        # Standardized query parameter contracts
| routes/
|   | index-new.js       # Resource-driven route aggregation
| services/
|   | strategiesService.js
|   | opportunitiesService.js
|   | executionsService.js
|   | positionsService.js
| utils/
|   | prices.js          # Price map with timestamps
|   | testUtils.js       # FIFO verification tests
```

## Core Resources

### 1. Strategies Service (`strategies`)

**Purpose**: Define trading strategies and control logic.

```javascript
// Get all strategies
const strategies = await strategies.getStrategies()

// Get specific strategy
const strategy = await strategies.getStrategy('volatility-breakout')
```

**Available Methods**:
- `getStrategies()` - Get all strategies
- `getStrategy(id)` - Get specific strategy by ID

**Data Structure**:
```javascript
{
  id: 'volatility-breakout',
  name: 'Volatility Breakout',
  description: 'Detects early volatility',
  type: 'volatility_breakout'
  // Note: layer is internal, not exposed in public API
}
```

### 2. Opportunities Service (`opportunities`)

**Purpose**: Present trading opportunities (resource-driven, not pipeline-driven).

```javascript
// Get all opportunities (newest first)
const opportunities = await opportunities.getOpportunities()

// Get opportunities for specific ticker
const nvdaOpportunities = await opportunities.getOpportunitiesByTicker('NVDA')

// Get opportunities from specific strategy
const breakoutOpportunities = await opportunities.getOpportunitiesByStrategy('volatility-breakout')
```

**Available Methods**:
- `getOpportunities()` - All opportunities sorted by `createdAt` descending
- `getOpportunity(id)` - Get specific opportunity
- `getOpportunitiesByStrategy(strategyId)` - Filter by strategy
- `getOpportunitiesByTicker(ticker)` - Filter by ticker

**Data Structure**:
```javascript
{
  id: 'opportunity-001',
  strategyId: 'volatility-breakout',
  ticker: 'NVDA',
  score: 0.82,
  confidence: 0.84,
  entryPrice: 482.15,
  stopPrice: 458.90,
  targetPrice: 545.20,
  createdAt: 1713347535000,
  side: 'buy',
  status: 'active',
  reasoning: 'Early volatility detected with volume spike'
  // Note: executed is derived client-side
}
```

### 3. Executions Service (`executions`)

**Purpose**: Record immutable trade executions.

```javascript
// Get all executions (newest first)
const executions = await executions.getExecutions()

// Get executions for specific ticker
const nvdaExecutions = await executions.getExecutionsByTicker('NVDA')

// Get executions from specific strategy
const breakoutExecutions = await executions.getExecutionsByStrategy('volatility-breakout')

// Get executions summary for dashboards
const summary = await executions.getExecutionsSummary()

// Create new execution (immutable append-only)
const newExecution = await executions.createExecution({
  ticker: 'AAPL',
  side: 'buy',
  quantity: 10,
  price: 165.00,
  portfolioId: 'portfolio-001',
  strategyId: 'volatility-breakout'
})
```

**Available Methods**:
- `getExecutions()` - All executions sorted by `createdAt` descending
- `getExecution(id)` - Get specific execution
- `getExecutionsByTicker(ticker)` - Filter by ticker
- `getExecutionsByStrategy(strategyId)` - Filter by strategy
- `getExecutionsByPortfolio(portfolioId)` - Filter by portfolio
- `createExecution(executionData)` - Create new immutable execution
- `getExecutionsSummary()` - Get aggregated metrics

**Data Structure**:
```javascript
{
  id: 'execution-001',
  portfolioId: 'portfolio-001',
  strategyId: 'volatility-breakout',
  opportunityId: 'opportunity-001', // nullable
  ticker: 'NVDA',
  side: 'buy',
  quantity: 10,
  price: 482.50,
  createdAt: 1713347700000,
  status: 'filled',
  commission: 4.95,
  fees: 0.50
  // Note: netValue = (quantity * price) + commission + fees (derived)
}
```

### 4. Positions Service (`positions`)

**Purpose**: Computed portfolio positions using FIFO cost basis.

```javascript
// Get all portfolios
const portfolios = await positions.getPortfolios()

// Get specific portfolio
const portfolio = await positions.getPortfolio('portfolio-001')

// Get computed positions (FIFO cost basis)
const positions = await positions.getPositions('portfolio-001')

// Get portfolio summary for dashboards
const summary = await positions.getPortfolioSummary('portfolio-001')
```

**Available Methods**:
- `getPortfolios()` - Get all portfolios
- `getPortfolio(id)` - Get specific portfolio
- `getPositions(portfolioId)` - Get computed positions with real-time valuation
- `getPortfolioSummary(portfolioId)` - Get portfolio metrics

**Positions Data Structure**:
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

## Data Types and Validation

### Shared Types (`types.js`)

**Enums**:
- `SIDE`: { BUY: 'buy', SELL: 'sell' } // strictly buy/sell only
- `OPPORTUNITY_STATUS`: { ACTIVE: 'active', WATCH: 'watch', EXPIRED: 'expired' }
- `TRADE_STATUS`: { FILLED: 'filled', PROPOSED: 'proposed', CANCELLED: 'cancelled' }
- `STRATEGY_LAYERS`: { DISCOVERY: 'discovery', ENGINE: 'engine' } // internal only

**Validation Functions**:
- `validateExecution(execution)` - Ensures required fields and valid enums
- `validateOpportunity(opportunity)` - Ensures score/confidence ranges

### Query Parameters (`query-params.js`)

Standardized query parameter contracts for all resources:

```javascript
// Common query parameters
QUERY_PARAMS = {
  STRATEGY_ID: 'strategyId',
  TICKER: 'ticker',
  PORTFOLIO_ID: 'portfolioId',
  OPPORTUNITY_ID: 'opportunityId',
  SIDE: 'side',
  STATUS: 'status',
  CREATED_AT: 'createdAt',
  DATE_FROM: 'dateFrom',
  DATE_TO: 'dateTo',
  LIMIT: 'limit',
  OFFSET: 'offset'
}
```

## Usage Patterns

### 1. Loading States

All API calls return promises. Use loading states in React:

```javascript
const [loading, setLoading] = useState(false)
const [opportunities, setOpportunities] = useState([])

const loadOpportunities = async () => {
  setLoading(true)
  try {
    const data = await opportunities.getOpportunities()
    setOpportunities(data)
  } finally {
    setLoading(false)
  }
}
```

### 2. Error Handling

API calls can throw errors. Handle them gracefully:

```javascript
const createExecution = async (executionData) => {
  try {
    return await executions.createExecution(executionData)
  } catch (error) {
    console.error('Execution creation failed:', error)
    setError(error.message)
  }
}
```

### 3. Derived State Pattern

Execution status is derived, not stored:

```javascript
// Check if opportunity was executed (client-side derivation)
const executed = executions.some(e => e.opportunityId === opportunity.id)

// Positions are always computed from executions
const positions = await positions.getPositions('portfolio-001')
```

### 4. Real-time Updates

Simulate real-time updates with polling:

```javascript
useEffect(() => {
  const pollForUpdates = async () => {
    try {
      const newOpportunities = await opportunities.getOpportunities()
      setOpportunities(newOpportunities)
    } catch (error) {
      console.error('Polling failed:', error)
    }
  }

  const interval = setInterval(pollForUpdates, 5000) // Poll every 5 seconds
  
  return () => clearInterval(interval)
}, [])
```

### 5. Mock vs Live Data

Toggle between mock and live data using config:

```javascript
// In src/api/config.js
export const API_CONFIG = {
  USE_MOCK: true, // Set to false for live data
  MOCK_DELAY: { min: 200, max: 800 },
  BASE_URL: 'https://api.lumantic.com'
}
```

## Best Practices

### 1. Component Integration

**DO**: Import services, not mock data directly
```javascript
// Good
import { opportunities } from '../api'
const opportunities = await opportunities.getOpportunities()

// Bad
import { mockOpportunities } from '../mock/data'
const opportunities = mockOpportunities
```

### 2. Data Transformation

Transform API responses to component-friendly formats:

```javascript
// Convert positions to display format
const positionsDisplay = positions.map(position => ({
  ...position,
  displayName: position.ticker,
  value: `$${position.marketValue.toLocaleString()}`,
  plColor: position.unrealizedPnL >= 0 ? 'green' : 'red',
  plPercent: `${position.unrealizedPnLPct >= 0 ? '+' : ''}${position.unrealizedPnLPct.toFixed(2)}%`
}))
```

### 3. Performance Optimization

- Use `useMemo` for expensive computations
- Implement proper loading states
- Cache API responses when appropriate
- Debounce user inputs

### 4. Testing

The API includes built-in verification:

```javascript
import { verifyFIFOLogic } from '../api/utils/testUtils'

// Run verification in tests or dev mode
if (process.env.NODE_ENV === 'development') {
  const result = verifyFIFOLogic()
  console.assert(result.passed, `FIFO test: ${result.error || 'passed'}`)
}
```

## Migration from Mock Data

### Step 1: Replace Direct Imports

**Before**:
```javascript
import { mockSignals } from '../mock/data'
```

**After**:
```javascript
import { opportunities } from '../api'
```

### Step 2: Update Component State

**Before**:
```javascript
const [signals, setSignals] = useState(mockSignals)
```

**After**:
```javascript
const [opportunities, setOpportunities] = useState([])
const [loading, setLoading] = useState(true)

useEffect(() => {
  const loadOpportunities = async () => {
    const data = await opportunities.getOpportunities()
    setOpportunities(data)
    setLoading(false)
  }
  loadOpportunities()
}, [])
```

### Step 3: Handle API Changes

The API layer maintains backward compatibility. When switching from mock to live:

1. Set `USE_MOCK: false` in `config.js`
2. Update `BASE_URL` to live API endpoint
3. All service calls work identically
4. Add error handling for network issues

## Complete Example

### Portfolio Component with New API

```javascript
import React, { useState, useEffect } from 'react'
import { positions as positionsService, executions } from '../api'

export default function Portfolio() {
  const [loading, setLoading] = useState(true)
  const [positionsList, setPositionsList] = useState([])
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const loadPortfolioData = async () => {
      try {
        setLoading(true)
        const [positionsData, summaryData] = await Promise.all([
          positionsService.getPositions('portfolio-001'),
          positionsService.getPortfolioSummary('portfolio-001')
        ])
        setPositionsList(positionsData)
        setSummary(summaryData)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadPortfolioData()
  }, [])

  if (loading) return <div>Loading portfolio...</div>
  if (error) return <div>Error: {error}</div>

  return (
    <div>
      <h2>Portfolio Summary</h2>
      <div>Total Value: ${summary?.totalValue || 0}</div>
      <div>Total P&L: {summary?.totalPnL || 0}</div>
      
      <h3>Positions</h3>
      {positionsList.map(position => (
        <div key={position.ticker}>
          <strong>{position.ticker}</strong>
          <span>Shares: {position.quantity}</span>
          <span>Avg Cost: ${position.avgCost.toFixed(2)}</span>
          <span>Current Price: ${position.currentPrice.toFixed(2)}</span>
          <span>Value: ${position.marketValue.toFixed(2)}</span>
          <span>P&L: {position.unrealizedPnL.toFixed(2)}</span>
          <span>P&L %: {(position.unrealizedPnLPct * 100).toFixed(2)}%</span>
        </div>
      ))}
    </div>
  )
}
```

## Resource-Driven Architecture

This architecture provides clean separation, easy testing, and seamless migration from mock to live data. The resource-driven design ensures that:

- **No pipeline leakage**: Internal implementation details are hidden
- **Derived state**: Prevents desync issues
- **Immutable logs**: Complete audit trails
- **Standard contracts**: Consistent across all resources
- **Consumer agnostic**: Works for frontend, bots, analytics, external users

## Architectural Consistency

### Derived State Pattern

A key architectural win is the consistent move from mixed state mutation to **all derived state OR immutable events**:

```javascript
// Before: Mixed approach (race conditions possible)
signals.markSignalExecuted(id) // Mutates state
holdings = computeHoldings() // Derived state

// After: Consistent pattern
executed = executions.some(e => e.opportunityId === id) // Always derived
positions = computePositionsFromExecutions() // Always derived
```

**Benefits**:
- **No race conditions**: State can't go out of sync
- **No stale UI**: Always computed from source of truth
- **No reconciliation bugs**: Single source of truth for all data

**Pattern Applied**:
- **Opportunities**: `executed` derived from executions
- **Positions**: Computed from executions (FIFO)
- **Executions**: Immutable append-only log
- **Strategies**: Static definitions

This consistency prevents the common bugs that plague most trading systems.

The API is production-ready and designed to serve any consumer without coupling to internal implementation details.
