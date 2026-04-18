# Alpha Engine API Integration

This document defines the endpoints and data shapes for integrating with the alpha-engine backend system.

## Base URL
```
https://api.alpha-engine.com/v1
```

## Authentication
All requests require JWT authentication:
```
Authorization: Bearer <jwt_token>
```

## Core Endpoints

### Strategies
Get available trading strategies from alpha-engine.

```http
GET /strategies
```

**Response Shape:**
```typescript
interface Strategy {
  id: string           // str_*
  name: string
  description: string
  type: string
  performance: {
    winRate: number
    avgReturn: number
    sharpeRatio: number
    maxDrawdown: number
  }
}
```

### Predictions
Get model predictions for trading opportunities.

```http
GET /predictions
```

**Query Parameters:**
- `strategyId` (string) - Filter by strategy
- `ticker` (string) - Filter by ticker symbol
- `direction` ('buy' | 'sell') - Filter by prediction direction
- `confidence` (number) - Minimum confidence threshold (0-1)
- `limit` (number) - Maximum results (default: 50, max: 100)

**Response Shape:**
```typescript
interface Prediction {
  id: string           // prd_*
  strategyId: string   // str_*
  ticker: string
  direction: 'buy' | 'sell'
  confidence: number   // 0-1
  entryPrice: number
  stopPrice: number
  targetPrice: number
  createdAt: number    // epoch ms
  regime: string       // Market context/conditions
  reasoning: string    // Model explanation
  metadata: {
    modelVersion: string
    dataWindow: string
    features: string[]
  }
}
```

### Market Data
Get real-time and historical market data.

```http
GET /market-data/{ticker}
```

**Query Parameters:**
- `interval` ('1m' | '5m' | '15m' | '1h' | '1d') - Time interval
- `period` (number) - Number of periods back
- `startDate` (string) - ISO date string for historical data

**Response Shape:**
```typescript
interface MarketData {
  ticker: string
  interval: string
  data: Array<{
    timestamp: number    // epoch ms
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  indicators?: {
    sma: number[]
    ema: number[]
    rsi: number[]
    macd: {
      macd: number[]
      signal: number[]
      histogram: number[]
    }
  }
}
```

### Model Performance
Get performance metrics for strategies and models.

```http
GET /performance/{strategyId}
```

**Query Parameters:**
- `period` ('1d' | '1w' | '1m' | '3m' | '6m' | '1y') - Performance period
- `benchmark` (string) - Benchmark ticker for comparison

**Response Shape:**
```typescript
interface Performance {
  strategyId: string
  period: string
  metrics: {
    totalReturn: number
    annualizedReturn: number
    volatility: number
    sharpeRatio: number
    maxDrawdown: number
    winRate: number
    avgWin: number
    avgLoss: number
    profitFactor: number
  }
  benchmark?: {
    ticker: string
    totalReturn: number
    correlation: number
    beta: number
  }
  dailyReturns: Array<{
    date: string         // YYYY-MM-DD
    return: number
    cumulative: number
  }>
}
```

### Risk Metrics
Get current risk assessments and metrics.

```http
GET /risk/metrics
```

**Query Parameters:**
- `portfolioId` (string) - Portfolio ID for portfolio-specific risk
- `tickers` (string[]) - Specific tickers to analyze

**Response Shape:**
```typescript
interface RiskMetrics {
  timestamp: number
  portfolioId?: string
  marketRisk: {
    var95: number        // Value at Risk 95%
    var99: number        // Value at Risk 99%
    expectedShortfall: number
    beta: number
    correlation: number
  }
  positionRisk: Array<{
    ticker: string
    exposure: number
    contribution: number
    marginalVar: number
  }>
  regime: {
    current: string
    confidence: number
    expectedVolatility: number
  }
}
```

### Signals
Get real-time trading signals from alpha-engine models.

```http
GET /signals
```

**Query Parameters:**
- `strategyId` (string) - Filter by strategy
- `signalType` ('entry' | 'exit' | 'risk') - Type of signal
- `active` (boolean) - Only active signals

**Response Shape:**
```typescript
interface Signal {
  id: string           // sig_*
  strategyId: string   // str_*
  ticker: string
  type: 'entry' | 'exit' | 'risk'
  direction: 'buy' | 'sell' | 'hold'
  strength: number     // 0-1 signal strength
  price: number        // Reference price
  timestamp: number    // epoch ms
  expiresAt: number    // epoch ms
  metadata: {
    indicators: Record<string, number>
    confidence: number
    reasoning: string
  }
}
```

### Backtesting
Run backtests on strategies.

```http
POST /backtest
```

**Request Body:**
```typescript
interface BacktestRequest {
  strategyId: string
  tickers: string[]
  startDate: string     // ISO date
  endDate: string       // ISO date
  initialCapital: number
  config?: {
    commission: number
    slippage: number
    positionSizing: 'fixed' | 'percent' | 'volatility'
    maxPositionSize?: number
  }
}
```

**Response Shape:**
```typescript
interface BacktestResult {
  id: string           // bkt_*
  strategyId: string
  period: {
    start: string
    end: string
  }
  performance: {
    totalReturn: number
    annualizedReturn: number
    sharpeRatio: number
    maxDrawdown: number
    winRate: number
    profitFactor: number
  }
  trades: Array<{
    ticker: string
    entryDate: string
    exitDate: string
    direction: 'buy' | 'sell'
    entryPrice: number
    exitPrice: number
    quantity: number
    pnl: number
    return: number
  }>
  equity: Array<{
    date: string
    equity: number
    drawdown: number
  }>
}
```

## WebSocket Streams

### Real-time Data Stream
Connect to WebSocket for real-time updates:

```
wss://api.alpha-engine.com/v1/stream
```

**Authentication:** Send JWT token as first message:
```json
{
  "type": "auth",
  "token": "jwt_token_here"
}
```

**Subscribe to data:**
```json
{
  "type": "subscribe",
  "channels": ["predictions", "signals", "market-data"],
  "tickers": ["AAPL", "GOOGL", "MSFT"]
}
```

**Stream Message Format:**
```typescript
interface StreamMessage {
  type: 'prediction' | 'signal' | 'market-data' | 'error'
  timestamp: number
  data: Prediction | Signal | MarketData | { error: string }
}
```

## Error Handling

All endpoints return consistent error format:

```typescript
interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: any
    timestamp: number
    requestId: string
  }
}
```

**Common Error Codes:**
- `INVALID_AUTH` - Authentication failed
- `RATE_LIMITED` - Too many requests
- `INVALID_PARAMS` - Invalid query parameters
- `RESOURCE_NOT_FOUND` - Requested resource doesn't exist
- `SERVICE_UNAVAILABLE` - Alpha-engine service down

## Rate Limits

- **Standard endpoints:** 100 requests/minute
- **Market data:** 500 requests/minute  
- **WebSocket connections:** 10 concurrent connections
- **Backtesting:** 5 requests/hour

## SDK Integration

### JavaScript/TypeScript Example

```typescript
import { AlphaEngineClient } from '@alpha-engine/sdk';

const client = new AlphaEngineClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.alpha-engine.com/v1'
});

// Get predictions
const predictions = await client.predictions.list({
  strategyId: 'str_ml_trend_v1',
  confidence: 0.8,
  limit: 20
});

// Get market data
const marketData = await client.marketData.get('AAPL', {
  interval: '1h',
  period: 24
});

// Subscribe to real-time signals
client.stream.subscribe(['signals'], ['AAPL', 'GOOGL']);
client.stream.on('signal', (signal) => {
  console.log('New signal:', signal);
});
```

### Python Example

```python
from alpha_engine import AlphaEngineClient

client = AlphaEngineClient(api_key='your-api-key')

# Get predictions
predictions = client.predictions.list(
    strategy_id='str_ml_trend_v1',
    confidence=0.8,
    limit=20
)

# Get performance metrics
performance = client.performance.get(
    strategy_id='str_ml_trend_v1',
    period='1m'
)

# Run backtest
backtest = client.backtest.run(
    strategy_id='str_ml_trend_v1',
    tickers=['AAPL', 'GOOGL'],
    start_date='2024-01-01',
    end_date='2024-12-31',
    initial_capital=100000
)
```

## Data Models Reference

### ID Format Convention
All IDs follow pattern: `{prefix}_{timestamp}_{random4}`
- `str_` - Strategy
- `prd_` - Prediction  
- `sig_` - Signal
- `bkt_` - Backtest

### Timestamp Format
All timestamps are Unix epoch milliseconds.

### Price Precision
- **Equities:** 2 decimal places
- **Forex:** 4 decimal places
- **Crypto:** 8 decimal places

### Confidence Scores
- **0.0 - 0.3:** Low confidence
- **0.3 - 0.7:** Medium confidence  
- **0.7 - 1.0:** High confidence

---

**Note:** This document should be kept in sync with the alpha-engine API documentation. Any changes to the API should be reflected here immediately.
