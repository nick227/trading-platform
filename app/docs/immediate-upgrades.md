# Immediate Upgrades: Small High-Impact Changes

## 🔧 Small Upgrades (Worth Doing Now)

### 1. Map in Services, Never in Components

```javascript
// predictionsService.js
export function mapPrediction(p) {
  return {
    ...p,
    side: p.direction.toUpperCase(),
    confidencePct: Math.round(p.confidence * 100)
  }
}
```

### 2. Unwrap API Once

```javascript
// api/client.js
export async function request(path, opts) {
  const r = await fetch(`/api${path}`, opts)
  const j = await r.json()
  return j.data ?? j
}
```

### 3. Single Fetch Client

```javascript
// api/client.js - One place for all API calls
export async function request(path, opts = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  })
  const json = await response.json()
  return json.data ?? json
}
```

## ⚠️ Guardrails

### No opportunityId Anywhere
- Use only `predictionId`
- Remove all `opportunityId` references

### No Stored Cost
- Compute `price * quantity` for display only
- Never store derived cost in database

### Positions = Derived from Executions Only
```javascript
// services/derivePositions.js
export function derivePositions(executions) {
  // Calculate current positions from buy/sell executions
  return calculatedPositions
}
```

## 🧠 One Consolidation

### Delete Extra Services Entirely
```javascript
// DELETE these files:
app/src/api/services/signalsService.js ❌
app/src/api/services/tradesService.js ❌  
app/src/api/services/opportunitiesService.js ❌
```

### Keep Only Core Services
```javascript
// KEEP these files:
app/src/api/services/predictionsService.js ✅
app/src/api/services/executionsService.js ✅
app/src/api/services/portfoliosService.js ✅
app/src/api/services/strategiesService.js ✅
```

## ⚡ Execution Shortcut

### Compressed Timeline
**Day 1–2**: Kill mocks + wire services
- Delete `mock/data.js`
- Remove all mock imports
- Wire core services to real APIs

**Day 3**: Mapping + core flow test
- Add mapping functions only
- Test: GET predictions → POST execution → GET executions

**Day 4**: Components + loading/error
- Replace mock state with API calls
- Add basic loading states

**Day 5**: Positions (FIFO)
- Derive positions from executions
- Test complete loop

## 🎯 Done = This Works

```
GET /predictions → display list
POST /executions → create trade  
GET /executions → update UI
derive positions → show holdings
```

### Final Note
**Don't redesign anything else until that loop works.**

Everything else (bots, realtime, polish) sits on top of that foundation.

## 📋 Quick Implementation Checklist

### Day 1-2:
- [ ] Delete `app/src/mock/data.js`
- [ ] Remove mock imports from all services
- [ ] Delete signalsService, tradesService, opportunitiesService
- [ ] Wire predictions/executions/portfolios/strategies to APIs
- [ ] Create single API client

### Day 3:
- [ ] Add mapPrediction/mapExecution functions
- [ ] Test predictions → execution → executions flow
- [ ] Verify data transformations work

### Day 4:
- [ ] Replace mock state in components
- [ ] Add loading states
- [ ] Add basic error handling

### Day 5:
- [ ] Implement derivePositions function
- [ ] Test complete trading loop
- [ ] Verify UI updates correctly

## 🚀 Success Criteria

When this works:
- ✅ Predictions load from real API
- ✅ User can create executions
- ✅ Executions list updates immediately
- ✅ Positions calculate correctly from executions
- ✅ No mock data anywhere in core flow

**Everything else is polish.**
