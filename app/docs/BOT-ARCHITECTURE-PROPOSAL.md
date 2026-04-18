# Bot Architecture Proposal - Rule Management & Strategy Integration

## **Current System Analysis**

### **What We Have Today**

**1. Frontend Bot Management:**
- `Bots.jsx` - Shows static `botPlaybooks` array
- Hardcoded playbook data: "Momentum Swing", "Regime Rotation", "DCA Engine"
- No connection to actual bot types or rules

**2. Backend Bot System:**
- `Bot` model with `config` JSON field
- `BotRule` model with typed rules (`price_threshold`, `position_limit`, `daily_loss`, `market_hours`, `cooldown`)
- `BotEvent` model for logging
- Worker engine evaluates rules in real-time

**3. Worker Rule Engine:**
- 5 rule types implemented in `/worker/src/engine/rules/`
- Rules are evaluated sequentially (first failure short-circuits)
- Rules are stored in database, loaded into memory every 3 seconds

**4. Strategy Integration:**
- Bots can reference `Strategy` records
- Alpha-engine strategies can be used as "bots"
- No clear separation between rule-based bots and strategy bots

---

## **The Problem**

### **1. Static Frontend Data**
```javascript
// Current Bots.jsx - STATIC DATA
const botPlaybooks = [
  { name: 'Momentum Swing', cadence: 'Intraday', edge: '+2.1%' },
  { name: 'Regime Rotation', cadence: 'Daily', edge: '+1.6%' },
  { name: 'DCA Engine', cadence: 'Weekly', edge: '+0.9%' }
]
```

### **2. No Rule Management UI**
- Rules exist in database but no way to create/edit them
- No rule templates or presets
- No rule validation or testing

### **3. Mixed Bot Types**
- Rule-based bots (worker engine)
- Strategy-based bots (alpha-engine)
- No clear distinction in UI

---

## **Proposed Solution: Hybrid Architecture**

### **Core Principles**

1. **Rule-based bots** = Configurable in worker, managed via UI
2. **Strategy-based bots** = Alpha-engine strategies, selected via UI  
3. **Unified bot catalog** = Single list showing both types
4. **Rule templates** = Predefined rule sets for common strategies

---

## **Architecture Design**

### **1. Bot Type Classification**

```typescript
// Bot.type enum in database
enum BotType {
  RULE_BASED,    // Worker engine rules
  STRATEGY_BASED // Alpha-engine strategies
}

// Bot model updates
model Bot {
  id           String     @id
  userId       String
  portfolioId  String
  strategyId   String?    // Only for STRATEGY_BASED
  type         BotType    // NEW: Classification
  name         String
  enabled      Boolean    @default(true)
  config       Json       // Different schema per type
  templateId   String?    // NEW: Reference to rule template
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
```

### **2. Rule Templates System**

```typescript
// New BotTemplate model
model BotTemplate {
  id          String     @id
  name        String
  description String
  type        BotType    // RULE_BASED only
  category    String     // 'momentum', 'mean_reversion', 'dca', etc.
  config      Json       // Template rule definitions
  metadata    Json       // Performance stats, risk metrics, etc.
  isSystem    Boolean    @default(false) // System templates vs user templates
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  bots Bot[]
}

// Template config structure
{
  "name": "Momentum Swing",
  "description": "Buys on price momentum, sells on reversal",
  "category": "momentum",
  "rules": [
    {
      "type": "market_hours",
      "config": { "open": "09:30", "close": "16:00" },
      "enabled": true
    },
    {
      "type": "price_threshold", 
      "config": { "operator": "above", "price": 0 },
      "enabled": true
    },
    {
      "type": "position_limit",
      "config": { "maxPositions": 1, "maxValue": 5000 },
      "enabled": true
    },
    {
      "type": "cooldown",
      "config": { "minutes": 15 },
      "enabled": true
    },
    {
      "type": "daily_loss",
      "config": { "maxLoss": 200 },
      "enabled": true
    }
  ],
  "defaultBotConfig": {
    "tickers": ["SPY", "QQQ"],
    "quantity": 10,
    "direction": "buy"
  },
  "metadata": {
    "cadence": "Intraday",
    "edge": "+2.1%",
    "risk": "Medium",
    "winRate": "64%"
  }
}
```

### **3. Unified Bot Catalog**

```typescript
// Frontend bot catalog structure
interface BotCatalogItem {
  id: string
  name: string
  type: 'RULE_BASED' | 'STRATEGY_BASED'
  category: string
  description: string
  metadata: {
    cadence: string
    edge: string
    risk: 'Low' | 'Medium' | 'High'
    winRate?: string
    avgHold?: string
  }
  isTemplate?: boolean // For rule-based templates
  strategyId?: string // For strategy-based bots
}
```

---

## **Implementation Plan**

### **Phase 1: Database Schema Updates**

**1. Add BotType enum**
```sql
-- Add bot type column
ALTER TABLE Bot ADD COLUMN type ENUM('RULE_BASED', 'STRATEGY_BASED') NOT NULL DEFAULT 'RULE_BASED';
ALTER TABLE Bot ADD COLUMN templateId VARCHAR(255);
```

**2. Create BotTemplate model**
```prisma
model BotTemplate {
  id          String     @id
  name        String
  description String
  type        BotType
  category    String
  config      Json
  metadata    Json
  isSystem    Boolean    @default(false)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  bots Bot[]
}
```

**3. Seed system templates**
```javascript
// Seed file: system-bot-templates.json
[
  {
    "name": "Momentum Swing",
    "description": "Buys on price momentum, sells on reversal",
    "type": "RULE_BASED",
    "category": "momentum",
    "config": { /* rule definitions */ },
    "metadata": { "cadence": "Intraday", "edge": "+2.1%" },
    "isSystem": true
  },
  {
    "name": "Regime Rotation", 
    "description": "Rotates between asset classes based on market regime",
    "type": "RULE_BASED",
    "category": "allocation",
    "config": { /* rule definitions */ },
    "metadata": { "cadence": "Daily", "edge": "+1.6%" },
    "isSystem": true
  },
  {
    "name": "DCA Engine",
    "description": "Dollar-cost averaging strategy",
    "type": "RULE_BASED", 
    "category": "dca",
    "config": { /* rule definitions */ },
    "metadata": { "cadence": "Weekly", "edge": "+0.9%" },
    "isSystem": true
  }
]
```

### **Phase 2: Backend API Updates**

**1. Bot catalog endpoint**
```javascript
// GET /api/bots/catalog
export async function getBotCatalog(userId) {
  // Get system templates
  const systemTemplates = await prisma.botTemplate.findMany({
    where: { isSystem: true },
    select: catalogSelect
  })
  
  // Get user templates  
  const userTemplates = await prisma.botTemplate.findMany({
    where: { isSystem: false },
    select: catalogSelect
  })
  
  // Get available strategies
  const strategies = await prisma.strategy.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      description: true
    }
  })
  
  return {
    templates: [...systemTemplates, ...userTemplates],
    strategies: strategies.map(s => ({
      ...s,
      type: 'STRATEGY_BASED',
      category: 'alpha_engine'
    }))
  }
}
```

**2. Bot creation from template**
```javascript
// POST /api/bots/from-template
export async function createBotFromTemplate(userId, data) {
  const { templateId, portfolioId, name, config } = data
  
  const template = await prisma.botTemplate.findUnique({
    where: { id: templateId }
  })
  
  if (!template) throw new Error('Template not found')
  
  // Create bot with template rules
  const bot = await prisma.bot.create({
    data: {
      id: generateId(ID_PREFIXES.BOT),
      userId,
      portfolioId,
      type: 'RULE_BASED',
      name: name || template.name,
      config: config || template.config.defaultBotConfig,
      templateId
    }
  })
  
  // Create rules from template
  for (const ruleConfig of template.config.rules) {
    await prisma.botRule.create({
      data: {
        id: generateId(ID_PREFIXES.RULE),
        botId: bot.id,
        name: ruleConfig.type,
        type: ruleConfig.type,
        config: ruleConfig.config,
        enabled: ruleConfig.enabled
      }
    })
  }
  
  return bot
}
```

### **Phase 3: Frontend Updates**

**1. Update Bots.jsx**
```javascript
// Replace static botPlaybooks with API call
export default function Bots() {
  const [catalog, setCatalog] = useState({ templates: [], strategies: [] })
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    getBotCatalog().then(setCatalog).finally(() => setLoading(false))
  }, [])
  
  // Unified catalog display
  const catalogItems = [
    ...catalog.templates.map(t => ({ ...t, type: 'RULE_BASED' })),
    ...catalog.strategies.map(s => ({ ...s, type: 'STRATEGY_BASED' }))
  ]
  
  return (
    <div className="page container">
      {/* Bot creation from catalog */}
      <section>
        <h2>Create New Bot</h2>
        <div className="bot-catalog">
          {catalogItems.map(item => (
            <BotCatalogCard 
              key={item.id} 
              item={item}
              onCreate={() => handleCreateBot(item)}
            />
          ))}
        </div>
      </section>
      
      {/* Active bots display */}
      <section>
        <h2>Active Bots</h2>
        {/* Existing bot list */}
      </section>
    </div>
  )
}
```

**2. Add BotCatalogCard component**
```javascript
function BotCatalogCard({ item, onCreate }) {
  return (
    <article className="bot-card">
      <div className="bot-card-header">
        <h3>{item.name}</h3>
        <span className={`bot-type ${item.type.toLowerCase()}`}>
          {item.type === 'RULE_BASED' ? 'Rules' : 'Strategy'}
        </span>
      </div>
      
      <p className="bot-description">{item.description}</p>
      
      <div className="bot-metadata">
        <div className="metadata-item">
          <span className="label">Cadence:</span>
          <span className="value">{item.metadata.cadence}</span>
        </div>
        <div className="metadata-item">
          <span className="label">Edge:</span>
          <span className="value">{item.metadata.edge}</span>
        </div>
        <div className="metadata-item">
          <span className="label">Risk:</span>
          <span className={`risk ${item.metadata.risk.toLowerCase()}`}>
            {item.metadata.risk}
          </span>
        </div>
      </div>
      
      <button className="primary pressable" onClick={onCreate}>
        Create Bot
      </button>
    </article>
  )
}
```

### **Phase 4: Rule Management UI**

**1. Rule Builder Component**
```javascript
function RuleBuilder({ rules, onChange }) {
  const [availableRules] = useState([
    { type: 'market_hours', name: 'Market Hours', config: {} },
    { type: 'price_threshold', name: 'Price Threshold', config: {} },
    { type: 'position_limit', name: 'Position Limit', config: {} },
    { type: 'cooldown', name: 'Cooldown', config: {} },
    { type: 'daily_loss', name: 'Daily Loss Limit', config: {} }
  ])
  
  const addRule = (ruleType) => {
    const ruleTemplate = availableRules.find(r => r.type === ruleType)
    onChange([...rules, {
      id: generateId(),
      type: ruleType,
      name: ruleTemplate.name,
      config: ruleTemplate.config,
      enabled: true
    }])
  }
  
  return (
    <div className="rule-builder">
      <div className="rules-list">
        {rules.map(rule => (
          <RuleEditor 
            key={rule.id}
            rule={rule}
            onChange={(updated) => updateRule(rule.id, updated)}
            onRemove={() => removeRule(rule.id)}
          />
        ))}
      </div>
      
      <div className="add-rule-section">
        <h4>Add Rule</h4>
        <div className="rule-types">
          {availableRules.map(rule => (
            <button 
              key={rule.type}
              onClick={() => addRule(rule.type)}
              disabled={rules.some(r => r.type === rule.type)}
            >
              {rule.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

---

## **File Organization**

### **Database Seeds**
```
server/
  prisma/
    seeds/
      system-bot-templates.json    # System rule templates
      bot-migration.sql            # Schema updates
```

### **Backend Services**
```
server/
  src/
    services/
      botTemplatesService.js      # Template CRUD
      botCatalogService.js         # Unified catalog
    routes/
      bots/
        templates.js               # Template endpoints
        catalog.js                 # Catalog endpoint
```

### **Frontend Components**
```
app/
  src/
    features/
      bots/
        Bots.jsx                   # Updated main page
        BotCatalog.jsx             # Catalog view
        BotCreate.jsx              # Creation flow
        RuleBuilder.jsx            # Rule management
        components/
          BotCatalogCard.jsx       # Catalog item
          RuleEditor.jsx           # Individual rule
```

---

## **Migration Strategy**

### **Step 1: Database Migration**
1. Add `type` and `templateId` columns to Bot table
2. Create BotTemplate table
3. Seed system templates
4. Migrate existing bots to RULE_BASED type

### **Step 2: Backend Updates**
1. Add template and catalog services
2. Update bot creation to support templates
3. Add bot type validation

### **Step 3: Frontend Updates**
1. Replace static botPlaybooks with API calls
2. Add catalog view
3. Add template-based bot creation
4. Add rule builder UI

### **Step 4: Testing & Rollout**
1. Test template creation and bot instantiation
2. Verify rule evaluation works with template rules
3. Test strategy-based bot creation
4. Gradual rollout with feature flags

---

## **Benefits**

### **1. Unified Experience**
- Single catalog for all bot types
- Consistent creation flow
- Clear distinction between rule-based and strategy-based

### **2. Rule Reusability**
- Templates for common strategies
- User can create custom templates
- Shareable rule configurations

### **3. Extensibility**
- Easy to add new rule types
- Simple to add new strategy integrations
- Template system supports complex strategies

### **4. Maintainability**
- Rules defined in data, not code
- Template updates propagate to existing bots
- Clear separation of concerns

---

## **Next Steps**

### **Immediate (This Week)**
1. Create database migration scripts
2. Seed system templates
3. Update backend bot service

### **Short Term (Next 2 Weeks)**
1. Implement catalog API
2. Update Bots.jsx frontend
3. Add template-based creation

### **Medium Term (Next Month)**
1. Add rule builder UI
2. Implement custom templates
3. Add template sharing

---

## **Final Recommendation**

**Adopt the hybrid architecture with rule templates.** This provides:

- **Immediate value**: Replace static data with dynamic templates
- **Long-term flexibility**: Extensible rule and strategy system  
- **User experience**: Unified catalog for all bot types
- **Maintainability**: Data-driven rule definitions

**The key insight**: Treat bot templates as "recipes" that can be instantiated, customized, and shared - similar to how Docker images work for containers.
