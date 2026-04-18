# Clean Bot Architecture - Final Design

## **The Correct Architecture (No Compromises)**

### **Core Principle: Rules = Data, Execution = Code**

```
SEED FILES (one-time)
   |
   v
BotTemplate (DB)  <- canonical templates
   |
   v
Bot (instance)
   |
   v
BotRule[] (runtime rules)
   |
   v
Worker evaluates rules
   |
   v
Execution created
```

---

## **1. Database Schema (Final)**

```prisma
enum BotType {
  RULE_BASED      // Worker executes BotRule[]
  STRATEGY_BASED  // Worker consumes predictions
}

model Bot {
  id           String     @id
  userId       String
  portfolioId  String
  strategyId   String?    // Only for STRATEGY_BASED
  type         BotType    // Classification
  name         String
  enabled      Boolean    @default(true)
  config       Json       // Runtime config (tickers, sizing, etc.)
  templateId   String?    // Creation-time reference only
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  deletedAt    DateTime?

  portfolio Portfolio @relation(fields: [portfolioId], references: [id])
  strategy  Strategy?  @relation(fields: [strategyId], references: [id])
  template  BotTemplate? @relation(fields: [templateId], references: [id])
  rules     BotRule[]  // Only for RULE_BASED
  events    BotEvent[]
  executions Execution[]
}

model BotTemplate {
  id          String     @id
  name        String
  description String
  category    String     // 'momentum', 'dca', 'mean_reversion'
  config      Json       // Rule definitions + default bot config
  metadata    Json       // Performance stats, risk metrics
  isSystem    Boolean    @default(false)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  bots Bot[]
}

model BotRule {
  id        String      @id
  botId     String
  name      String
  type      BotRuleType
  config    Json        // Rule-specific config
  enabled   Boolean     @default(true)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  bot Bot @relation(fields: [botId], references: [id])
}

enum BotRuleType {
  price_threshold
  position_limit
  daily_loss
  market_hours
  cooldown
}
```

---

## **2. Clean Separation of Concerns**

### **RULE_BASED Bots**
```javascript
// Bot record
{
  type: "RULE_BASED",
  strategyId: null,
  config: {
    tickers: ["SPY", "QQQ"],
    quantity: 10,
    direction: "buy"
  },
  templateId: "tpl_momentum_swing" // Reference only
}

// BotRule[] records (owned by bot)
[
  { type: "market_hours", config: { open: "09:30", close: "16:00" } },
  { type: "price_threshold", config: { operator: "above", price: 0 } },
  { type: "position_limit", config: { maxPositions: 1, maxValue: 5000 } },
  { type: "cooldown", config: { minutes: 15 } },
  { type: "daily_loss", config: { maxLoss: 200 } }
]
```

### **STRATEGY_BASED Bots**
```javascript
// Bot record
{
  type: "STRATEGY_BASED",
  strategyId: "str_alpha_momentum",
  config: {
    tickers: ["SPY", "QQQ"],
    sizing: "fixed",
    quantity: 10
  },
  templateId: null // No templates for strategy bots
}

// BotRule[] records (optional, for risk controls only)
[
  { type: "position_limit", config: { maxPositions: 3, maxValue: 10000 } },
  { type: "daily_loss", config: { maxLoss: 500 } }
]
```

---

## **3. BotTemplate Schema (Exact)**

```json
{
  "name": "Momentum Swing",
  "description": "Buys on price momentum, sells on reversal",
  "category": "momentum",
  "config": {
    "rules": [
      {
        "type": "market_hours",
        "name": "Market Hours Filter",
        "config": { "open": "09:30", "close": "16:00" },
        "enabled": true
      },
      {
        "type": "price_threshold",
        "name": "Price Momentum Trigger",
        "config": { "operator": "above", "price": 0 },
        "enabled": true
      },
      {
        "type": "position_limit",
        "name": "Position Size Limit",
        "config": { "maxPositions": 1, "maxValue": 5000 },
        "enabled": true
      },
      {
        "type": "cooldown",
        "name": "Trade Cooldown",
        "config": { "minutes": 15 },
        "enabled": true
      },
      {
        "type": "daily_loss",
        "name": "Daily Loss Limit",
        "config": { "maxLoss": 200 },
        "enabled": true
      }
    ],
    "defaultBotConfig": {
      "tickers": ["SPY", "QQQ"],
      "quantity": 10,
      "direction": "buy"
    }
  },
  "metadata": {
    "cadence": "Intraday",
    "edge": "+2.1%",
    "risk": "Medium",
    "winRate": "64%",
    "avgHold": "1.8 sessions"
  }
}
```

---

## **4. File Placement (Idiomatic)**

### **Seed Files (Bootstrap Only)**
```
server/prisma/seeds/
  bot-templates.json          // System templates
  bot-migration.sql          // Schema updates
```

### **Runtime (DB Only)**
```
Database:
  BotTemplate                 // Canonical templates
  Bot                         // Bot instances
  BotRule                     // Runtime rules
```

### **Worker (Rule Evaluators Only)**
```
worker/src/engine/rules/
  marketHours.js              // Evaluates market_hours rule
  priceThreshold.js           // Evaluates price_threshold rule
  positionLimit.js           // Evaluates position_limit rule
  cooldown.js                 // Evaluates cooldown rule
  dailyLoss.js                // Evaluates daily_loss rule
```

### **Frontend (No Static Data)**
```
app/src/features/bots/
  Bots.jsx                    // GET /api/bots/catalog
  BotCatalog.jsx              // Dynamic catalog
  BotCreate.jsx               // Template-based creation
```

---

## **5. API Design (Clean)**

### **Bot Catalog (Unified)**
```javascript
// GET /api/bots/catalog
export async function getBotCatalog(userId) {
  // Rule-based bots from templates
  const templates = await prisma.botTemplate.findMany({
    where: { isSystem: true },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      metadata: true
    }
  })

  // Strategy-based bots from strategies
  const strategies = await prisma.strategy.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      type: true
    }
  })

  return {
    ruleBased: templates.map(t => ({
      ...t,
      type: 'RULE_BASED',
      metadata: t.metadata
    })),
    strategyBased: strategies.map(s => ({
      ...s,
      type: 'STRATEGY_BASED',
      category: 'alpha_engine',
      metadata: { cadence: 'Real-time', edge: 'Strategy-driven' }
    }))
  }
}
```

### **Bot Creation (Template-Based)**
```javascript
// POST /api/bots/from-template
export async function createBotFromTemplate(userId, data) {
  const { templateId, portfolioId, name, config } = data
  
  const template = await prisma.botTemplate.findUnique({
    where: { id: templateId }
  })
  
  if (!template) throw new Error('Template not found')

  // Create bot (templateId is reference only)
  const bot = await prisma.bot.create({
    data: {
      id: generateId(ID_PREFIXES.BOT),
      userId,
      portfolioId,
      type: 'RULE_BASED',
      name: name || template.name,
      config: config || template.config.defaultBotConfig,
      templateId // Reference only, not mutable
    }
  })

  // Create rules from template (bot owns these forever)
  for (const ruleConfig of template.config.rules) {
    await prisma.botRule.create({
      data: {
        id: generateId(ID_PREFIXES.RULE),
        botId: bot.id,
        name: ruleConfig.name,
        type: ruleConfig.type,
        config: ruleConfig.config,
        enabled: ruleConfig.enabled
      }
    })
  }

  return bot
}
```

---

## **6. Worker Logic (Rule Types Only)**

```javascript
// worker/src/engine/botEngine.js
async function evaluateRule(rule, bot, ticker, positions) {
  // Worker only knows rule TYPES, not template names
  switch (rule.type) {
    case 'market_hours':
      return evaluateMarketHours(rule.config)
    case 'price_threshold':
      return evaluatePriceThreshold(rule.config, ticker)
    case 'position_limit':
      return evaluatePositionLimit(rule.config, ticker, positions)
    case 'cooldown':
      return evaluateCooldown(rule.config, bot.id, ticker)
    case 'daily_loss':
      return evaluateDailyLoss(rule.config, bot.portfolioId)
    default:
      console.warn(`Unknown rule type: ${rule.type}`)
      return { pass: true }
  }
}

// Strategy bot execution (separate path)
async function executeStrategyBot(bot, ticker) {
  // Get predictions from alpha-engine
  const prediction = await getPrediction(bot.strategyId, ticker)
  
  // Apply optional risk controls (BotRule[])
  const canExecute = await evaluateRiskControls(bot.rules, ticker)
  
  if (canExecute && prediction.signal === 'BUY') {
    // Create execution
    return createExecution(bot, ticker, prediction)
  }
}
```

---

## **7. Critical Rules (No Exceptions)**

### **DO THIS:**
- [x] Rules live in DB (BotRule)
- [x] Templates live in DB (BotTemplate, seeded)
- [x] Worker knows rule TYPES only
- [x] UI reads catalog from API
- [x] Template updates DON'T affect existing bots
- [x] Strategy bots use separate path

### **DO NOT DO:**
- [x] Runtime config files
- [x] Static frontend bot lists
- [x] Shared mutable templates
- [x] Rule logic outside worker
- [x] Template names in worker

---

## **8. Migration Path**

### **Step 1: Database Schema**
```sql
-- Add bot classification
ALTER TABLE Bot ADD COLUMN type ENUM('RULE_BASED', 'STRATEGY_BASED') NOT NULL DEFAULT 'RULE_BASED';
ALTER TABLE Bot ADD COLUMN templateId VARCHAR(255);

-- Create template table
CREATE TABLE BotTemplate (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  config JSON NOT NULL,
  metadata JSON,
  isSystem BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### **Step 2: Seed Templates**
```javascript
// server/prisma/seeds/bot-templates.json
[
  {
    "id": "tpl_momentum_swing",
    "name": "Momentum Swing",
    "description": "Buys on price momentum, sells on reversal",
    "category": "momentum",
    "isSystem": true,
    "config": { /* template schema */ }
  },
  {
    "id": "tpl_regime_rotation",
    "name": "Regime Rotation", 
    "description": "Rotates between asset classes based on market regime",
    "category": "allocation",
    "isSystem": true,
    "config": { /* template schema */ }
  },
  {
    "id": "tpl_dca_engine",
    "name": "DCA Engine",
    "description": "Dollar-cost averaging strategy",
    "category": "dca",
    "isSystem": true,
    "config": { /* template schema */ }
  }
]
```

### **Step 3: Frontend Updates**
```javascript
// Replace static botPlaybooks
// Before:
const botPlaybooks = [
  { name: 'Momentum Swing', cadence: 'Intraday', edge: '+2.1%' },
  // ...
]

// After:
const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })

useEffect(() => {
  getBotCatalog().then(setCatalog)
}, [])
```

---

## **9. Next Leverage Points**

### **Option 1: Rule Validation System**
```javascript
// server/src/services/ruleValidation.js
export function validateRuleConfig(type, config) {
  const schemas = {
    market_hours: {
      open: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
      close: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' }
    },
    price_threshold: {
      operator: { type: 'string', enum: ['above', 'below'] },
      price: { type: 'number', minimum: 0 }
    }
    // ... other rule schemas
  }
  
  return validate(config, schemas[type])
}
```

### **Option 2: Strategy Bot Execution Flow**
```javascript
// worker/src/engine/strategyEngine.js
export async function executeStrategyBot(bot, ticker) {
  // 1. Get prediction from alpha-engine
  const prediction = await getAlphaPrediction(bot.strategyId, ticker)
  
  // 2. Check prediction confidence
  if (prediction.confidence < 0.7) return { pass: false, reason: 'low_confidence' }
  
  // 3. Apply risk controls (BotRule[])
  const riskCheck = await evaluateRiskControls(bot.rules, ticker)
  if (!riskCheck.pass) return riskCheck
  
  // 4. Create execution
  return createExecution(bot, ticker, {
    direction: prediction.direction,
    quantity: calculatePositionSize(bot, prediction),
    price: prediction.targetPrice
  })
}
```

### **Option 3: Template Schema Validation**
```javascript
// server/src/services/templateValidation.js
export function validateBotTemplate(template) {
  const requiredFields = ['name', 'description', 'category', 'config']
  const configSchema = {
    rules: { type: 'array', minItems: 1 },
    defaultBotConfig: { type: 'object' }
  }
  
  // Validate template structure
  // Validate each rule in rules array
  // Validate defaultBotConfig
  return validationResult
}
```

---

## **10. Final Truth**

**One-Line Truth:** Templates create bots, bots own rules, worker executes rules.

**Key Insights:**
- Templates are data factories, not runtime configs
- Rules live in DB, not files
- Worker knows rule types only, not template names
- Template updates don't affect existing bots
- Strategy bots are prediction-driven, not rule-driven

**The Architecture Is:**
- **Seed Files** (one-time) -> **BotTemplate** (DB) -> **Bot** (instance) -> **BotRule[]** (runtime) -> **Worker** (execution)

**This is clean, idiomatic, and future-proof.**
