# Bot API Contract - REST Endpoints

## **🔥 Complete REST API Specification**

### **Bot Catalog & Management**
```
GET    /api/bots/catalog
GET    /api/bots
GET    /api/bots/:id
POST   /api/bots/from-template
POST   /api/bots
PATCH  /api/bots/:id
DELETE /api/bots/:id
```

### **Bot Rules Management**
```
GET    /api/bots/:id/rules
POST   /api/bots/:id/rules
PUT    /api/bots/:id/rules
PATCH  /api/bots/:id/rules/:ruleId
DELETE /api/bots/:id/rules/:ruleId
```

### **Bot Events & Executions**
```
GET    /api/bots/:id/events
GET    /api/executions?botId=:id
```

---

## **📋 Endpoint Specifications**

### **GET /api/bots/catalog**
**Purpose:** Fetch available bot templates for creation
**Response:**
```json
{
  "ruleBased": [
    {
      "id": "tpl_price_threshold",
      "name": "Price Threshold Bot",
      "description": "Executes when price crosses threshold",
      "type": "RULE_BASED"
    }
  ],
  "strategyBased": [
    {
      "id": "tpl_momentum_v2", 
      "name": "Momentum Strategy",
      "description": "Follows momentum indicators",
      "type": "STRATEGY_BASED"
    }
  ]
}
```

---

### **GET /api/bots**
**Purpose:** List user's bots with filtering
**Query Parameters:**
- `enabled=true` (optional) - Filter by enabled status
- `portfolioId=prt_123` (optional) - Filter by portfolio
- `type=RULE_BASED|STRATEGY_BASED` (optional) - Filter by type
- `limit=25` (optional, default: 25) - Pagination limit
- `offset=0` (optional, default: 0) - Pagination offset

**Response:**
```json
{
  "items": [
    {
      "id": "bot_123",
      "name": "My NVDA Bot",
      "type": "RULE_BASED",
      "enabled": true,
      "portfolioId": "prt_stub_demo",
      "templateId": "tpl_price_threshold",
      "strategyId": null,
      "config": {
        "tickers": ["NVDA"],
        "quantity": 10,
        "direction": "buy"
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 42,
  "limit": 25,
  "offset": 0
}
```

---

### **GET /api/bots/:id**
**Purpose:** Get specific bot details
**Response:**
```json
{
  "id": "bot_123",
  "name": "My NVDA Bot",
  "type": "RULE_BASED",
  "enabled": true,
  "portfolioId": "prt_stub_demo",
  "templateId": "tpl_price_threshold",
  "strategyId": null,
  "config": {
    "tickers": ["NVDA"],
    "quantity": 10,
    "direction": "buy"
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

---

### **POST /api/bots/from-template**
**Purpose:** Create bot from template (primary user flow)
**Body:**
```json
{
  "templateId": "tpl_price_threshold",
  "portfolioId": "prt_stub_demo",
  "name": "My NVDA Bot",
  "config": {
    "tickers": ["NVDA"],
    "quantity": 10,
    "direction": "buy"
  }
}
```

**Response:**
```json
{
  "id": "bot_123",
  "name": "My NVDA Bot",
  "type": "RULE_BASED",
  "enabled": false,
  "portfolioId": "prt_stub_demo",
  "templateId": "tpl_price_threshold",
  "strategyId": null,
  "config": {
    "tickers": ["NVDA"],
    "quantity": 10,
    "direction": "buy"
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

---

### **POST /api/bots**
**Purpose:** Direct bot creation (advanced users)
**Body:**
```json
{
  "name": "Advanced Strategy Bot",
  "type": "STRATEGY_BASED",
  "portfolioId": "prt_stub_demo",
  "strategyId": "str_momentum_v2",
  "config": {
    "tickers": ["SPY"],
    "quantity": 5,
    "direction": "buy",
    "minConfidence": 0.7
  }
}
```

---

### **PATCH /api/bots/:id**
**Purpose:** Update bot (partial updates)
**Body (all optional):**
```json
{
  "name": "Updated Bot Name",
  "enabled": true,
  "config": {
    "tickers": ["NVDA", "AAPL"],
    "quantity": 15
  }
}
```

---

### **Status Field**
**Purpose:** Separate user intent from runtime reality
**Values:**
- `draft` - Initial state, not ready to run
- `running` - Currently executing in worker
- `paused` - Temporarily stopped by user
- `error` - Worker encountered error
- `offline` - Worker not connected

**Examples:**
```json
{
  "enabled": true,
  "status": "offline"
}
{
  "enabled": true,
  "status": "running"
}
```

---

### **Last Activity Fields**
**Purpose:** Massive UI value for bot status
**Fields in GET /api/bots/:id response:**
```json
{
  "id": "bot_123",
  "name": "My NVDA Bot",
  "type": "RULE_BASED",
  "enabled": true,
  "status": "offline",
  "lastRunAt": "2024-01-15T10:30:00Z",
  "lastEventAt": "2024-01-15T10:25:00Z",
  "lastExecutionAt": "2024-01-15T09:45:00Z",
  "portfolioId": "prt_stub_demo",
  "templateId": "tpl_price_threshold",
  "strategyId": null,
  "config": {
    "tickers": ["NVDA"],
    "quantity": 10,
    "direction": "buy"
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

---

### **DELETE /api/bots/:id**
**Purpose:** Soft delete bot
**Response:**
```json
{
  "success": true
}
```

---

## **🔧 Bot Rules API**

### **GET /api/bots/:id/rules**
**Response:**
```json
[
  {
    "id": "rule_123",
    "type": "price_threshold",
    "order": 1,
    "enabled": true,
    "config": {
      "ticker": "NVDA",
      "threshold": 150.0,
      "direction": "above"
    },
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
]
```

---

### **POST /api/bots/:id/rules**
**Body:**
```json
{
  "type": "cooldown",
  "order": 1,
  "config": {
    "minutes": 30
  }
}
```

---

### **PUT /api/bots/:id/rules**
**Purpose:** Bulk replace all rules (drag/drop UI)
**Body:**
```json
[
  {
    "id": "rule_123",
    "type": "price_threshold",
    "order": 1,
    "enabled": true,
    "config": {
      "ticker": "NVDA",
      "threshold": 150.0,
      "direction": "above"
    }
  },
  {
    "id": "rule_124",
    "type": "cooldown",
    "order": 2,
    "enabled": true,
    "config": {
      "minutes": 30
    }
  }
]
```

**Response:**
```json
{
  "success": true,
  "count": 2
}
```

---

### **PATCH /api/bots/:id/rules/:ruleId**
**Body (all optional):**
```json
{
  "enabled": false,
  "order": 2,
  "config": {
    "minutes": 60
  }
}
```

---

### **DELETE /api/bots/:id/rules/:ruleId**
**Response:**
```json
{
  "success": true
}
```

---

## **📊 Events & Executions API**

### **GET /api/bots/:id/events**
**Query Parameters:**
- `limit=50` (optional, default: 50)
- `after=evt_17133` (optional) - Cursor pagination
- `type=error|execution_created|rule_triggered` (optional) - Event type filtering

**Response:**
```json
{
  "items": [
    {
      "id": "evt_123",
      "type": "rule_triggered",
      "detail": "Price threshold rule triggered for NVDA",
      "metadata": {
        "ticker": "NVDA",
        "price": 152.30,
        "threshold": 150.0
      },
      "executionId": "exec_456",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "nextCursor": "evt_17134"
}
```

---

### **GET /api/executions?botId=:id**
**Query Parameters:**
- `botId=bot_123` (required) - Filter by bot
- `limit=25` (optional, default: 25)
- `offset=0` (optional, default: 0)

**Response:**
```json
{
  "items": [
    {
      "id": "exec_456",
      "ticker": "NVDA",
      "quantity": 10,
      "direction": "buy",
      "price": 152.30,
      "status": "completed",
      "portfolioId": "prt_stub_demo",
      "botId": "bot_123",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 15,
  "limit": 25,
  "offset": 0
}
```

---

## **✅ Validation Rules**

### **Required Fields**
- **RULE_BASED**: Requires `templateId` or `rules`
- **STRATEGY_BASED**: Requires `strategyId`
- **All bots**: `name`, `portfolioId`, `config.tickers`, `config.quantity`

### **Field Validation**
- `quantity >= 1` - Minimum 1 share
- `tickers` non-empty array, normalized uppercase
- `minConfidence` between 0 and 1 (inclusive)
- `direction` must be "buy" or "sell"

### **State Rules**
- `enabled=false` → Worker ignores bot
- `enable call` → Worker reloads bot
- `disable call` → Worker unloads bot
- `delete call` → Soft delete + worker unload

---

## **🏗️ System Architecture**

### **Recommended Bot Types**
```
RULE_BASED     - Template-based rule execution
STRATEGY_BASED - Strategy-driven execution
```

### **Data Flow**
```
Catalog creates bots.
Bots own rules.
Events explain behavior.
Executions are financial truth.
```

### **🏁 Best Bot Model**
```
Bot
- identity
- enabled
- status
- config
- timestamps

BotRule
- constraints

BotEvent
- audit trail

Execution
- financial truth
```

### **Worker Integration**
- Bot state changes trigger worker reload/unload
- Events are emitted for all bot actions
- Executions create financial records
- Rules are evaluated in order

---

## **🎯 One-Line Truth**

**Catalog creates bots, bots own rules, events explain behavior, executions are financial truth.**
