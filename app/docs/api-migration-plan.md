# API Layer Migration Plan

## Overview
This document outlines the comprehensive migration plan to centralize all mock data behind a client-side API layer, creating a clean separation between UI components and data sources while enabling seamless transition to live APIs.

## Phase 1: Mock Data Inventory

### Current Mock Data Locations

#### 1. Central Mock Data (`src/mock/data.js`)
```javascript
// User data
export const mockUser = { name: "Camela", avatar: "https://picsum.photos/40" }

// Core entities
export const mockAssets = [
  { symbol:'NVDA', name:'NVIDIA', change:'+2.4%', value:12400, series:[10,20,15,30,25,40] },
  { symbol:'AAPL', name:'Apple', change:'-1.2%', value:8600, series:[20,15,18,14,12,10] }
]

export const mockBots = [
  { id:1, name:"Alpha Bot", status:"running", asset:"NVDA" },
  { id:2, name:"DCA Bot", status:"paused", asset:"AAPL" }
]

export const mockOrders = [
  { id:1, type:"BUY", asset:"NVDA", amount:1000 },
  { id:2, type:"SELL", asset:"AAPL", amount:500 }
]

export const mockTrades = [
  { id: 1, side: 'Buy', symbol: 'NVDA', amount: '$1,000', time: '09:30' },
  { id: 2, side: 'Sell', symbol: 'AAPL', amount: '$500', time: '10:15' }
]
```

#### 2. Component-Level Mock Data

**Orders.jsx (`src/features/Orders.jsx`)**
```javascript
// Enhanced stock data (8 stocks with detailed info)
const availableStocks = [
  { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 275.56, change: +2.4, volume: '52.3M', sector: 'Technology', marketCap: '6.8T', pe: '65.2' },
  // ... 7 more stocks
]

// Alpha engine predictions
const alphaPredictions = {
  'NVDA': { signal: 'STRONG_BUY', confidence: 85, target: 295.00, timeframe: '30d', reasoning: 'AI demand surge...' },
  // ... for all 8 stocks
}

// User holdings
const userHoldings = {
  'NVDA': { shares: 45, avgCost: 240.00 },
  'AAPL': { shares: 32, avgCost: 156.25 },
  'TSLA': { shares: 12, avgCost: 233.33 }
}

// Dynamic price history generator
const generatePriceHistory = (basePrice, volatility = 0.02) => { /* ... */ }
```

**Portfolio.jsx (`src/features/Portfolio.jsx`)**
```javascript
// Holdings data (3 stocks)
const holdingsData = [
  {
    ticker: 'NVDA', company: 'NVIDIA Corporation', marketValue: 12400,
    buyIn: 10800, shares: 45, avgCost: 240.00, currentPrice: 275.56,
    change: +35.56, changePct: +14.8, ageDays: 12, sector: 'Technology',
    avatar: 'https://logo.clearbit.com/nvidia.com', weight: 59.0
  },
  // ... AAPL, TSLA
]

// User stats
const userStats = {
  totalValue: 21000, dailyChangeAmount: 420, dailyChangePct: 2.0,
  activeBots: { running: 2, total: 3 }, topStrategy: { name: 'Volatility Breakout', return: 12.4 },
  avgHoldTime: 13, mostTradedAsset: 'NVDA'
}

// Recent activity
const recentActivity = [
  { event: 'Alpha Bot executed NVDA', value: '+$420', time: '2m ago', type: 'buy' },
  // ... 4 more activities
]
```

**Landing.jsx (`src/features/Landing.jsx`)**
```javascript
// Market pulse data
const marketPulse = {
  regime: 'RISK_ON', signalBreadth: 68, volatilityRegime: 'MODERATE',
  topOpportunity: 'Semis + AI Infra', vix: 16.8, sp500Change: '+1.2%',
  sentimentScore: 72.3, lastUpdate: new Date().toLocaleTimeString()
}

// Live signals
const liveSignals = [
  { symbol: 'NVDA', strategy: 'Volatility Breakout', confidence: 0.84, entry: 482.15, stop: 458.90, target: 545.20, timestamp: '09:32:15' },
  // ... 4 more signals
]

// Dimensional predictions
const dimensionalPredictions = [
  { symbol: 'NVDA', axis: 'HIGH_VOL_TREND_TECH_AGGRESSIVE_7d', prediction: 0.084, confidence: 0.84, actual: null },
  // ... 4 more predictions
]

// Performance metrics
const performanceMetrics = {
  dailyPnL: 2847.32, weeklyPnL: 12468.91, monthlyPnL: 48927.45,
  winRate: 0.68, sharpeRatio: 1.84, maxDrawdown: -0.082,
  activePositions: 12, totalTrades: 284, avgWin: 342.18, avgLoss: -189.73
}

// Strategy performance
const strategyPerformance = [
  { name: 'Volatility Breakout', edge: '+2.1%', winRate: '72%', trades: 48, avgHold: '3.2d', status: 'ACTIVE' },
  // ... more strategies
]
```

**OrderConfirm.jsx (`src/features/OrderConfirm.jsx`)**
```javascript
// Mock price fetching
const fetchLatestPrice = async (symbol) => {
  // Simulates API delay and returns price with ±1% variation
  const basePrices = { 'NVDA': 275.56, 'AAPL': 168.75, /* ... */ }
  // Returns price with random variation
}
```

**StrategyChart.jsx (`src/components/StrategyChart.jsx`)**
```javascript
// Mock strategy vs Dow comparison data
const generateMockData = () => {
  // Generates 60 days of strategy and Dow returns
  // Returns { dates, strategyReturns, dowReturns, predictions }
}
```

**Calendar.jsx (`src/components/Calendar.jsx`)**
```javascript
// Mock prediction data for calendar
const mockPredictions = [
  { date: new Date(2026, 3, 5), type: 'BUY', symbol: 'NVDA', confidence: 0.84, target: 545.20, entry: 482.15 },
  // ... 8 more predictions
]
```

#### 3. API Layer (`src/api/profileClient.js`)
```javascript
// User profile management (already partially abstracted)
import { mockUser } from '../mock/data'

// Functions: getProfileState, loginWithName, updateUsername, resetPassword, saveAlpacaApiKey, testAlpacaApiKey
```

## Phase 2: API Route Mapping

### Proposed API Endpoints

#### Core Data APIs
```
GET /api/assets              -> mockAssets
GET /api/assets/:symbol      -> Single asset details
GET /api/bots               -> mockBots
GET /api/bots/:id           -> Single bot details
GET /api/orders             -> mockOrders
GET /api/orders/:id         -> Single order details
GET /api/trades             -> mockTrades
GET /api/trades/:id         -> Single trade details
```

#### Trading APIs
```
GET /api/stocks              -> availableStocks (enhanced list)
GET /api/stocks/:symbol     -> Single stock with details
GET /api/stocks/:symbol/history -> generatePriceHistory()
GET /api/stocks/:symbol/price -> fetchLatestPrice()
GET /api/alpha/predictions  -> alphaPredictions
GET /api/alpha/predictions/:symbol -> Single alpha prediction
GET /api/portfolio/holdings -> holdingsData
GET /api/portfolio/stats    -> userStats
GET /api/portfolio/activity -> recentActivity
```

#### Analytics APIs
```
GET /api/market/pulse       -> marketPulse
GET /api/market/signals     -> liveSignals
GET /api/market/predictions -> dimensionalPredictions
GET /api/performance/metrics -> performanceMetrics
GET /api/performance/strategies -> strategyPerformance
GET /api/performance/chart  -> generateMockData()
GET /api/calendar/predictions -> mockPredictions
```

#### User Management APIs
```
GET /api/user/profile       -> mockUser
POST /api/user/login        -> loginWithName()
PUT /api/user/username      -> updateUsername()
POST /api/user/reset-password -> resetPassword()
POST /api/user/alpaca-key   -> saveAlpacaApiKey()
POST /api/user/test-alpaca  -> testAlpacaApiKey()
```

## Phase 3: API Layer Architecture

### Proposed Structure

```
src/api/
  index.js                 // Main API client entry point
  config.js               // API configuration (mock/live flag, base URLs)
  adapters/               // Data adapters
    mockAdapter.js        // Mock data adapter
    liveAdapter.js         // Live API adapter (future)
  services/               // Service layer
    assetsService.js      // Asset-related operations
    tradingService.js     // Trading operations
    portfolioService.js   // Portfolio operations
    analyticsService.js   // Analytics operations
    userService.js        // User management
  utils/
    delay.js              // Simulated API delays
    response.js           // Response formatting
```

### API Client Design

```javascript
// src/api/index.js
import { createAPI } from './config'
import * as assetsService from './services/assetsService'
import * as tradingService from './services/tradingService'
import * as portfolioService from './services/portfolioService'
import * as analyticsService from './services/analyticsService'
import * as userService from './services/userService'

const api = createAPI()

export const assets = assetsService(api)
export const trading = tradingService(api)
export const portfolio = portfolioService(api)
export const analytics = analyticsService(api)
export const user = userService(api)

export default {
  assets,
  trading,
  portfolio,
  analytics,
  user
}
```

### Configuration System

```javascript
// src/api/config.js
export const API_CONFIG = {
  USE_MOCK: true, // Toggle switch for mock/live data
  MOCK_DELAY: { min: 200, max: 800 }, // Simulated API delays
  BASE_URL: 'https://api.lumantic.com', // Future live API base
  ENDPOINTS: {
    // All endpoint definitions
  }
}

export function createAPI() {
  return {
    config: API_CONFIG,
    // Common API methods (get, post, put, delete)
  }
}
```

## Phase 4: Migration Strategy

### Step 1: Create API Layer Structure
1. Create `src/api/` directory structure
2. Set up configuration system with mock/live toggle
3. Create base API client with common methods
4. Implement mock adapter with delay simulation

### Step 2: Migrate Data to Services
1. Move all mock data to `src/api/data/` directory
2. Create service files for each domain (assets, trading, etc.)
3. Implement service methods that return mock data through API layer
4. Add proper error handling and response formatting

### Step 3: Update Components
1. Replace direct mock imports with API service calls
2. Update component state management to handle async loading
3. Add loading states and error handling to components
4. Test all functionality with mock API layer

### Step 4: Refactor and Optimize
1. Remove all mock data from components
2. Clean up unused imports and code
3. Add proper TypeScript types (if applicable)
4. Implement caching strategies for frequently accessed data

### Step 5: Live API Preparation
1. Create live adapter structure
2. Implement proper error handling for network failures
3. Add retry logic and timeout handling
4. Set up proper authentication headers

## Implementation Details

### Mock Data Organization

```
src/api/data/
  assets/
    stocks.js          // Stock data and predictions
    holdings.js        // Portfolio holdings
  trading/
    orders.js          // Order data
    trades.js          // Trade history
  analytics/
    market.js          // Market pulse, signals
    performance.js     // Performance metrics
    calendar.js        // Calendar predictions
  user/
    profile.js         // User profile data
```

### Service Layer Example

```javascript
// src/api/services/assetsService.js
export function createAssetsService(api) {
  return {
    async getStocks() {
      return api.get('/api/stocks')
    },
    
    async getStock(symbol) {
      return api.get(`/api/stocks/${symbol}`)
    },
    
    async getStockHistory(symbol, options = {}) {
      return api.get(`/api/stocks/${symbol}/history`, options)
    },
    
    async getStockPrice(symbol) {
      return api.get(`/api/stocks/${symbol}/price`)
    }
  }
}
```

### Component Migration Example

**Before:**
```javascript
import { availableStocks, alphaPredictions } from './mock-data'

const stock = availableStocks.find(s => s.symbol === selectedSymbol)
const prediction = alphaPredictions[selectedSymbol]
```

**After:**
```javascript
import { assets } from '../api'

const [loading, setLoading] = useState(true)
const [stock, setStock] = useState(null)
const [prediction, setPrediction] = useState(null)

useEffect(() => {
  const loadData = async () => {
    try {
      const [stockData, predictionData] = await Promise.all([
        assets.getStock(selectedSymbol),
        assets.getAlphaPrediction(selectedSymbol)
      ])
      setStock(stockData)
      setPrediction(predictionData)
    } catch (error) {
      // Handle error
    } finally {
      setLoading(false)
    }
  }
  loadData()
}, [selectedSymbol])
```

## Benefits of This Approach

1. **Clean Separation**: Components focus on UI, API layer handles data
2. **Easy Testing**: Mock API can be easily replaced with test doubles
3. **Live Transition**: Simple toggle to switch from mock to live data
4. **Consistent Interface**: All data access follows same patterns
5. **Better Error Handling**: Centralized error management
6. **Performance**: Opportunity for caching and optimization
7. **Maintainability**: Single source of truth for data logic

## Timeline

- **Week 1**: Create API structure and move all mock data
- **Week 2**: Implement service layer and update components
- **Week 3**: Testing, optimization, and cleanup
- **Week 4**: Live API preparation and documentation

## Success Criteria

- [ ] All mock data removed from components
- [ ] API layer fully functional with mock data
- [ ] Components work with async API calls
- [ ] Proper loading and error states implemented
- [ ] Mock/live toggle works correctly
- [ ] Code is clean and maintainable
- [ ] Documentation is complete
