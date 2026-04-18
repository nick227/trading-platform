# Implementation Upgrades: High-Impact Improvements

## 🧠 3 Upgrades (High Value, Low Effort)

### 1. Normalize API Responses Once

**Problem**: Mapping scattered across components
```javascript
// BAD - scattered in components
side = direction.toUpperCase()
confidence = confidence * 100
```

**Solution**: Centralize in service layer only
```javascript
// GOOD - one place
function mapPrediction(p) {
  return {
    ...p,
    side: p.direction.toUpperCase(),
    confidencePct: Math.round(p.confidence * 100)
  }
}
```

**Benefits**: UI clean + consistent

### 2. Standardize Response Shape Early

**Problem**: Backend returns wrapped responses
```json
{ data: [...] }
```

**Solution**: Unwrap in services
```javascript
// GOOD - consistent shape
export default function createService(api) {
  return {
    async getAll() {
      const response = await api.get('/endpoint')
      return response.data  // Unwrap once
    }
  }
}
```

**Benefits**: Components always get arrays, not wrapped objects

### 3. Add Minimal Retry/Fallback

**Problem**: Engine/API will fail during development
```javascript
// BAD - UI breaks on errors
const response = await api.get('/predictions')
return response.data
```

**Solution**: Graceful fallback
```javascript
// GOOD - prevents UI breaking
try {
  return await api.get('/predictions')
} catch {
  return []  // Fallback for early dev
}
```

**Benefits**: Prevents UI from breaking during early dev

## ⚠️ 2 Guardrails (Important)

### 1. Don't Mix Executions + Positions State

**Bad**:
```javascript
setExecutions(...)
setPositions(...)
```

**Good**:
```javascript
positions = derive(executions)  // One source of truth
```

### 2. Don't Over-Map Fields

**Avoid**:
```javascript
entry → entryPrice
target → targetPrice
```

**Keep**: Backend naming everywhere
**Allow only**:
- direction → side (UI-only)
- confidence → % (UI-only)

## 🧠 One Subtle Improvement

### Polling Helper (Not Manual Intervals)

**Problem**: Duplicated polling logic
```javascript
// BAD - repeated everywhere
useEffect(() => {
  const id = setInterval(fn, 20000)
  return () => clearInterval(id)
}, [])
```

**Solution**: Reusable hook
```javascript
// GOOD - reusable
function usePolling(fn, interval = 20000) {
  useEffect(() => {
    fn()
    const id = setInterval(fn, interval)
    return () => clearInterval(id)
  }, [])
}
```

**Benefits**: Prevents duplicated logic across pages

## 🔥 6 Consolidations That Pay Off Immediately

### 1. One API Client, Not Many

**Problem**: Services have their own fetch logic
**Solution**: Centralize
```javascript
// api/client.js
export async function request(path, opts = {}) {
  const res = await fetch(`/api${path}`, opts)
  const json = await res.json()
  return json.data
}
```

**Benefits**: Consistent, debuggable, easy to change

### 2. One Mapper Per Resource

**Standardize**:
- predictionsService → mapPrediction
- executionsService → mapExecution

**Never**: Map inside components

### 3. Delete Duplicate Service Concepts

**Keep only**:
- predictionsService
- executionsService  
- portfoliosService
- strategiesService

**Remove**:
- signalsService ❌
- tradesService ❌
- opportunitiesService ❌

### 4. Derive Positions in ONE Place

```javascript
// services/derivePositions.js
export function derivePositions(executions) {
  // Calculate positions from buy/sell executions
  return calculatedPositions
}
```

**Never**: Recompute differently in components

### 5. Standard Response Shape Everywhere

**All services return**: array OR object
**Never**: `{ data: { data: [...] } }`

**Unwrap once** in service layer

### 6. Centralize Enums/Constants

```javascript
// api/constants.js
export const DIRECTION = {
  BUY: 'buy',
  SELL: 'sell'
}

export const SIDE = {
  BUY: 'BUY',
  SELL: 'SELL'
}
```

**Benefits**: Prevents string bugs later

## ⚠️ 3 Things to Avoid (Long-Term Pain)

### ❌ 1. "UI-Shaped Models"

**Don't create**:
- ExecutionViewModel
- SignalCardModel

**Just use**: API shape + small derived fields

### ❌ 2. Spreading Logic Across Components

**Bad**:
```javascript
price * quantity everywhere
```

**Good**:
```javascript
mapExecution() once
```

### ❌ 3. Premature Abstraction Layers

**Skip**:
- Repositories
- Adapters  
- Domain layers

**You don't need them yet.**

## 🧠 One High-Impact Improvement

### Co-Locate Service + Mapper + Types

**Structure**:
```
api/
  executions/
    service.js
    mapper.js
    types.js
```

**Benefits**: When something changes, you edit one place

## 🎯 Ideal Final Structure

```
api/
  client.js          // One API client
  constants.js       // Centralized enums

  predictions/
  executions/
  portfolios/
  strategies/

services/
  derivePositions.js   // One place to compute
```

## 🟢 Outcome

**You get**:
- Fewer files
- Fewer concepts  
- Faster changes
- Easier debugging
- One-line principle

**One source of truth per concept, one place to transform it.**
