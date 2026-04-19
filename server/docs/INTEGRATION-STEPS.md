# Integration Steps - Bot System

## **🔥 Final Integration Checklist**

### **✅ Current Status**
- **Database Schema**: Deployed and synchronized ✅
- **Service Layer**: Complete implementation ready ✅
- **API Layer**: All 15 endpoints implemented ✅
- **Frontend**: Production-ready components ✅

### **🔄 Required Integration Steps**

#### **1. Update Routes Registration**
**File**: `server/src/loaders/routes.js`
**Current**: Uses old `bots/index.js`
**Action**: Replace with new routes

```javascript
// Replace line 3:
import botRoutes from '../routes/bots-new.js'

// This will enable all new endpoints:
// GET /api/bots (with filtering)
// POST /api/bots/from-template
// PATCH /api/bots/:id (enable/disable/status)
// PUT /api/bots/:id/rules (bulk replace)
// GET /api/bots/:id/events (with filtering)
```

#### **2. Update Frontend API Calls**
**Files**: `app/src/features/Bots.jsx`, `BotCreate.jsx`
**Current**: Uses old API endpoints
**Action**: Update to use new contract

```javascript
// Update to use new endpoints:
// GET /api/bots/catalog (template catalog)
// POST /api/bots/from-template (creation)
// PATCH /api/bots/:id (enable/disable)
// GET /api/bots/:id/events (event filtering)
```

#### **3. Worker Integration**
**File**: `worker/src/engine/botEngine.js`
**Current**: Uses old Bot model
**Action**: Update for new schema fields

```javascript
// Update worker to use new Bot model:
// - status field (draft/running/paused/error/offline)
// - lastRunAt, lastEventAt, lastExecutionAt
// - Template vs Strategy based handling
```

#### **4. Testing & Validation**
**Action**: End-to-end integration testing
**Priority**: Verify all flows work correctly

```bash
# Test bot creation flow
curl -X POST http://localhost:3000/api/bots/from-template \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "tpl_price_threshold",
    "portfolioId": "prt_stub_demo", 
    "name": "Test Bot",
    "config": {
      "tickers": ["NVDA"],
      "quantity": 10,
      "direction": "buy"
    }
  }'

# Test bot listing with filtering
curl "http://localhost:3000/api/bots?enabled=true&type=RULE_BASED"

# Test event filtering
curl "http://localhost:3000/api/bots/bot_123/events?type=error&limit=10"
```

---

## **🎯 Integration Priority**

### **High Priority** (Must Complete)
1. **Route Registration** - 5 minutes
   - Update `routes.js` to use `bots-new.js`
   - Test all new endpoints respond correctly

2. **Frontend Integration** - 15 minutes
   - Update `BotCreate.jsx` to use new API endpoints
   - Update `Bots.jsx` to use new filtering
   - Test bot creation flow end-to-end

3. **Worker Updates** - 20 minutes
   - Update worker to read new Bot schema
   - Implement status management
   - Add activity tracking

### **Medium Priority** (Complete if Time)
4. **Error Handling** - 10 minutes
   - Add comprehensive error logging
   - Implement proper HTTP status codes
   - Add validation error responses

5. **Performance Testing** - 15 minutes
   - Test pagination performance
   - Verify bulk rule operations
   - Test filtering performance

---

## **📋 Integration Commands**

### **Route Registration**
```bash
cd c:\wamp64\www\trading-platform\server
# Backup old routes
cp src/loaders/routes.js src/loaders/routes-old.js

# Update routes
# Edit src/loaders/routes.js line 3:
# Change: import botRoutes from '../routes/bots/index.js'
# To: import botRoutes from '../routes/bots-new.js'

npm run dev
```

### **Frontend Updates**
```bash
cd c:\wamp64\www\trading-platform\app
# Update BotCreate.jsx to use new endpoints
# Update Bots.jsx to use new filtering

npm start
```

### **Testing**
```bash
# Test bot creation
curl -X POST http://localhost:3000/api/bots/from-template {...}

# Test bot listing
curl http://localhost:3000/api/bots?enabled=true

# Test event filtering
curl http://localhost:3000/api/bots/bot_123/events?type=error
```

---

## **✅ Integration Complete When**

- [ ] New routes registered and responding
- [ ] Frontend uses new API endpoints
- [ ] Worker reads new Bot schema
- [ ] End-to-end bot creation flow works
- [ ] Event filtering works correctly
- [ ] Bulk rule operations functional
- [ ] All validation rules enforced

---

## **🏆 One-Line Truth**

**Update routes registration, integrate frontend with new API endpoints, and adapt worker to new schema for complete bot system integration.**
