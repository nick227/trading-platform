# Mock Data Replacement: Fast Implementation Plan

## 🔥 Cut Immediately

### ❌ Delete These Files/Concepts
- `app/src/mock/data.js` → Delete entirely
- `app/src/api/services/opportunitiesService.js` → Delete (use /predictions directly)
- `app/src/api/services/tradesService.js` → Replace entirely with executionsService
- Complex profile/auth → Keep stub only
- "Phases" → Overkill, do it in 2 passes max

## ✅ Real Implementation Order (Faster + Safer)

### Day 1: Kill Mocks
1. **Delete mock/data.js**
2. **Remove all mock imports** from services
3. **Replace tradesService** → use executionsService directly
4. **Keep profile stub only** (no complex auth)

### Day 2: Wire Core Services Only
1. **executionsService** → /api/executions
2. **predictionsService** → /api/predictions  
3. **portfoliosService** → /api/portfolios
4. **strategiesService** → /api/strategies

**Skip everything else for now.**

### Day 3: Add Minimal Mapping Only
1. **direction → side** (uppercase)
2. **confidence → %** (multiply by 100)

**Nothing else.**

### Day 4: Fix Components (No New Abstractions)
1. **Replace mock state → API calls**
2. **Add loading + error** states

### Day 5: Derive Positions (Don't Fetch)
1. **positions = computed from executions**
2. **No separate positions API calls**

## ⚠️ Key Corrections

- **"opportunities → predictions"** → Just delete opportunities layer
- **"cost field"** → Derive only, don't store  
- **"phases"** → Overkill, do it in 2 passes max
- **"bots early"** → Leave bots last

## 🎯 Real Success Condition

```
predictions load → 
user creates execution → 
execution appears → 
positions update
```

**If that works, everything else is polish.**

## 📋 Action Checklist

### Day 1:
- [ ] Delete `app/src/mock/data.js`
- [ ] Remove all mock imports
- [ ] Replace tradesService with executionsService
- [ ] Simplify profile to stub only

### Day 2:
- [ ] Wire executionsService → /api/executions
- [ ] Wire predictionsService → /api/predictions
- [ ] Wire portfoliosService → /api/portfolios  
- [ ] Wire strategiesService → /api/strategies

### Day 3:
- [ ] Add direction → side mapping
- [ ] Add confidence → % mapping
- [ ] Test core data flow

### Day 4:
- [ ] Replace mock state in components
- [ ] Add loading states
- [ ] Add error handling

### Day 5:
- [ ] Derive positions from executions
- [ ] Test complete flow
- [ ] Verify end-to-end

## 🚀 Final Verdict

**Your plan is correct—but simplify it by ~40% and execute faster.**

Focus on core trading loop first. Everything else is polish.
