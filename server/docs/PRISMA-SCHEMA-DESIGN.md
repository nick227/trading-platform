# Prisma Schema Design - Bot System

## **🔥 Schema Aligned to Final API Contract**

### **Core Models**

```prisma
enum BotType {
  RULE_BASED
  STRATEGY_BASED
}

enum BotStatus {
  draft
  running
  paused
  error
  offline
}

enum BotRuleType {
  price_threshold
  position_limit
  daily_loss
  market_hours
  cooldown
}

enum ExecutionAuditEventType {
  execution_created
  claimed
  submit_attempted
  submit_confirmed
  reconciled
  partial_fill
  filled
  cancelled
  retry_scheduled
  failed
  risk_blocked
}

model Bot {
  id                String    @id
  name              String
  type              BotType
  enabled            Boolean   @default(true)
  status            BotStatus  @default(draft)
  portfolioId        String
  templateId         String?   // For RULE_BASED bots
  strategyId         String?   // For STRATEGY_BASED bots
  config            Json       // { tickers, quantity, direction, minConfidence }
  lastRunAt          DateTime?
  lastEventAt         DateTime?
  lastExecutionAt     DateTime?
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt

  // Relations
  portfolio          Portfolio  @relation(fields: [portfolioId], references: [id])
  template           BotTemplate? @relation(fields: [templateId], references: [id])
  strategy           Strategy?   @relation(fields: [strategyId], references: [id])
  rules              BotRule[]
  events             BotEvent[]
  executions         Execution[]
  audits             ExecutionAudit[]

  // Indexes
  @@index([portfolioId, enabled])
  @@index([type, status])
  @@index([status])
  @@index([lastRunAt])
  @@index([lastEventAt])
  @@index([lastExecutionAt])
}

model BotTemplate {
  id          String   @id
  name        String
  description String
  type        BotType
  config      Json?    // Default configuration template
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  bots        Bot[]

  // Indexes
  @@index([type])
  @@index([name])
}

model BotRule {
  id        String     @id
  botId     String
  type       BotRuleType
  order      Int        // Execution order
  enabled    Boolean    @default(true)
  config     Json       // Rule-specific configuration
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  // Relations
  bot        Bot @relation(fields: [botId], references: [id])

  // Indexes
  @@index([botId, order])
  @@index([botId, enabled])
  @@index([type])
}

model BotEvent {
  id         String   @id
  botId       String
  type        String   // Flexible event types
  detail      String
  metadata    Json?    // Event-specific data
  executionId  String?  // Link to execution if applicable
  createdAt   DateTime @default(now())

  // Relations
  bot         Bot @relation(fields: [botId], references: [id])
  execution   Execution? @relation(fields: [executionId], references: [id])

  // Indexes
  @@index([botId, createdAt])
  @@index([type, createdAt])
  @@index([executionId])
}

model Execution {
  id            String    @id
  ticker        String
  quantity       Int
  price         Float
  direction      String    // "buy" | "sell"
  status        String    // "queued" | "claimed" | "completed" | "failed"
  portfolioId   String
  botId         String?
  strategyId    String?
  predictionId  String?
  clientOrderId String    // For broker integration
  activeIntentKey String? // For execution tracking
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Relations
  portfolio     Portfolio @relation(fields: [portfolioId], references: [id])
  bot           Bot?       @relation(fields: [botId], references: [id])
  strategy      Strategy?  @relation(fields: [strategyId], references: [id])
  prediction    Prediction? @relation(fields: [predictionId], references: [id])
  events        BotEvent[]
  audits        ExecutionAudit[]

  // Indexes
  @@index([portfolioId, createdAt])
  @@index([ticker, createdAt])
  @@index([botId, createdAt])
  @@index([status, createdAt])
  @@index([clientOrderId])
}

model ExecutionAudit {
  id          String                  @id
  executionId  String
  userId      String
  workerId    String?
  eventType   ExecutionAuditEventType
  detail      String
  metadata    Json?
  createdAt   DateTime                @default(now())

  // Relations
  execution   Execution @relation(fields: [executionId], references: [id])

  // Indexes
  @@index([executionId, createdAt])
  @@index([eventType, createdAt])
  @@index([userId, createdAt])
}
```

---

## **🏗️ Schema Design Principles**

### **1. Clean Separation**
- **Bot** - Identity, state, configuration
- **BotTemplate** - Reusable templates for creation
- **BotRule** - Individual rule constraints
- **BotEvent** - Audit trail of all bot actions
- **Execution** - Financial truth of trades
- **ExecutionAudit** - Detailed execution lifecycle tracking

### **2. Status Management**
- **enabled** - User intent (can be true while status is offline)
- **status** - Runtime reality (draft, running, paused, error, offline)
- **Activity fields** - lastRunAt, lastEventAt, lastExecutionAt

### **3. Type Safety**
- **BotType enum** - RULE_BASED vs STRATEGY_BASED
- **BotStatus enum** - Defined status values
- **BotRuleType enum** - Available rule types
- **ExecutionAuditEventType enum** - Complete audit trail

### **4. Performance Indexes**
- **Composite indexes** for common query patterns
- **Time-based indexes** for activity tracking
- **Status indexes** for filtering and monitoring
- **Relation indexes** for efficient joins

### **5. Flexible Configuration**
- **JSON config** - Flexible bot configuration
- **JSON metadata** - Extensible event data
- **Optional relations** - Template vs Strategy based on type

---

## **🎯 API Alignment**

### **GET /api/bots/:id Response**
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

### **POST /api/bots/from-template**
```javascript
// Creates Bot with:
// - templateId from BotTemplate
// - type from BotTemplate.type
// - config merged from template + user input
// - status = draft (ready for worker)
```

### **PATCH /api/bots/:id**
```javascript
// Updates:
// - enabled (user intent)
// - status (runtime state)
// - config (user changes)
// - name (user changes)
```

---

## **✅ Validation Rules**

### **Bot Creation**
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
- `status=running` → Worker actively executing
- `status=paused` → Worker temporarily stopped
- `status=error` → Worker encountered issue
- `status=offline` → Worker not connected

---

## **🏆 One-Line Truth**

**Clean schema design enables robust bot management with clear separation of concerns and comprehensive audit trails.**
