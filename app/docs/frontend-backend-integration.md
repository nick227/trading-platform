# Frontend-Backend Integration: Critical Path Plan

## The 3 Things That Actually Matter

1. **Turn off mocks**
2. **Fix endpoint names** 
3. **Map data shapes**

Everything else is secondary.

## Step 1: Turn Off Mocks (Today)

```javascript
// app/src/api/config.js
export const API_CONFIG = {
  USE_MOCK: false,
  BASE_URL: 'http://localhost:3000',
  VERSION: ''  // Remove version prefix
}
```

## Step 2: Fix Endpoint Names

| Frontend | Backend | Action |
|----------|---------|--------|
| `/api/signals` | `/api/predictions` | Update signals service |
| `/api/trades` | `/api/executions` | Update trades service |
| `/api/portfolios` | `/api/portfolios` | No change |
| `/api/strategies` | `/api/strategies` | No change |
| `/api/bots` | `/api/bots` | No change |

## Step 3: Map Data Shapes (Minimal)

### Predictions Mapping
```javascript
// Transform backend to frontend format
function mapPrediction(p) {
  return {
    ...p,
    side: p.direction.toUpperCase(),  // 'buy' -> 'BUY'
    confidence: Math.round(p.confidence * 100)  // 0.85 -> 85
  }
}
```

### Executions Mapping
```javascript
// Transform backend to frontend format  
function mapExecution(e) {
  return {
    ...e,
    side: e.direction.toUpperCase(),  // 'buy' -> 'BUY'
    // Note: cost is calculated in display, not stored
  }
}
```

## What to Delete

Remove all references to:
- `opportunityId` (backend uses `predictionId`)
- Mock data arrays
- Complex derived fields (calculate in display)

## What to Skip (For Now)

- WebSockets (use simple polling if needed)
- Complex caching layers
- Advanced error handling
- Analytics transformations

## Implementation Sequence

### Today
1. Update `API_CONFIG.USE_MOCK = false`
2. Start backend server
3. Test basic connectivity

### Tomorrow  
1. Fix signals endpoint (`/api/predictions`)
2. Fix trades endpoint (`/api/executions`)
3. Add minimal mapping functions

### Day 3
1. Delete all mock arrays
2. Test: GET predictions, GET executions, POST execution
3. Wire UI to display real data

## ✅ Phase 2 Complete: Endpoint Mapping + Data Transformation

### What's Done
- ✅ **Signals Service**: Updated to use `/api/predictions` with mapping
  - `direction` → `side` (buy → BUY)
  - `confidence` → percentage (0.85 → 85)
- ✅ **Trades Service**: Updated to use `/api/executions` with mapping  
  - `direction` → `type` (buy → BUY)
  - Real POST to create executions
- ✅ **Endpoints File**: Updated to reflect correct backend paths
- ✅ **API Config**: `USE_MOCK: false`, pointing to localhost:3001

### Current Status
- **Backend**: Running on http://localhost:3001 with API docs at /docs
- **Frontend**: Running on http://localhost:5173/lumantic/ with proxy
- **Database**: MySQL connection needed (expected for initial setup)

### Test Results
- ✅ **API Docs**: Accessible at http://localhost:3001/docs
- ⚠️ **Predictions**: Returns 500 (engine not running - expected)
- ⚠️ **Executions**: Returns 500 (MySQL connection - expected)

## Success Definition

When MySQL is set up:
```
prediction shows -> click -> create execution -> shows in list
```

## Key Architectural Principle

**Frontend matches backend contract with minimal transformation**

## ✅ Phase 3 In Progress: Mock Arrays Removed

### What's Done
- ✅ **Executions Service**: All mock data removed, using real `/api/executions`
  - Real GET, POST, and summary endpoints
  - Data mapping: `type` ↔ `direction`
- ✅ **Signals Service**: All mock data removed, using real `/api/predictions`
  - Data mapping: `direction` ↔ `side`, `confidence` → percentage
- ✅ **Clean Architecture**: No mock arrays anywhere in core services

### Current Status
- **Backend**: Running with API docs at http://localhost:3001/docs
- **Frontend**: Ready to consume real data
- **Services**: Fully wired to backend endpoints

### Test Results
- ✅ **API Connectivity**: Backend endpoints accessible
- ⚠️ **POST Testing**: PowerShell curl syntax issues (browser test needed)
- ⚠️ **Data Flow**: Engine/MySQL dependencies expected

### Next Steps
1. **Browser Test**: Test POST execution via browser dev tools
2. **UI Integration**: Verify frontend displays real backend data
3. **End-to-End**: Confirm prediction → execution → list flow

## Success Definition

When this works:
```
prediction shows -> click -> create execution -> shows in list
```

## Key Architectural Principle

**Frontend matches backend contract with minimal transformation**
