# Unified Metrics Pipeline Implementation Proposal

## Executive Summary

This document proposes a unified metrics pipeline that eliminates siloed calculation systems. Instead of separate user, template, and site metrics jobs, we build one canonical fact table with reusable aggregation layers. This approach ensures we "never calculate the same thing twice" while providing real-time performance metrics for all system components.

## Core Problem with Siloed Approach

Current thinking leads to three separate systems:
- User metrics system  
- Template metrics system
- Daily site metrics system

Each recalculating the same data with different SQL joins - wasteful and complex.

## Unified Architecture

### 1. Canonical Immutable Fact Table

Every closed trade becomes one normalized metric fact:

```sql
model TradeMetricFact {
  id                  String   @id @default(cuid())
  date                DateTime @db.Date
  userId              String
  botId               String?
  templateId          String?
  sourceExecutionId   String   // Links to original execution
  eventType           String   // 'fill' | 'deposit' | 'withdrawal' | 'transfer'
  sourceType          String   // 'MANUAL' | 'TEMPLATE' | 'CUSTOM_RULE' | 'ML_SIGNAL' | 'REBALANCE' | 'UNKNOWN'
  sourceId            String?  // templateId, botId, strategyId, userActionId
  pnl                 Decimal  @db.Decimal(12, 2)
  returnPct           Decimal  @db.Decimal(8, 4)
  isWin               Boolean  @default(false)
  capitalUsed         Decimal  @db.Decimal(12, 2)
  holdingMinutes      Int
  direction           String   // 'buy' | 'sell'
  ticker              String
  quantity            Float
  entryPrice          Decimal  @db.Decimal(10, 4)
  exitPrice           Decimal  @db.Decimal(10, 4)
  dailyEquityReturn   Decimal  @db.Decimal(8, 6) // For proper Sharpe calculation
  allocatedCapital    Decimal  @db.Decimal(12, 2) // Return denominator
  cashFlowAmount      Decimal? @db.Decimal(12, 2) // For deposits/withdrawals
  portfolioValue      Decimal? @db.Decimal(12, 2) // Portfolio value after event
  processed           Boolean  @default(false) // Watermark replacement
  createdAt           DateTime @default(now())
  
  @@index([processed, createdAt])
  @@index([date])
  @@index([userId, date])
  @@index([templateId, date])
  @@index([sourceExecutionId])
  @@index([sourceType, sourceId])
}
```

**This is the only source of truth.**

### 2. Daily Aggregate Layers

Compute once per day (incremental):

```sql
model TemplateMetricDay {
  id                    String   @id @default(cuid())
  date                  DateTime @db.Date
  templateId            String
  activeUsers           Int      @default(0)
  activeBots            Int      @default(0)
  totalTrades           Int      @default(0)
  winningTrades         Int      @default(0)
  totalPnl              Decimal  @default(0) @db.Decimal(12, 2)
  totalReturn           Decimal  @default(0) @db.Decimal(8, 4)
  avgWinRate            Decimal  @default(0) @db.Decimal(5, 2)
  dailyEquityReturn     Decimal  @default(0) @db.Decimal(8, 6) // For Sharpe
  maxDrawdown           Decimal  @default(0) @db.Decimal(5, 2)
  startingEquity        Decimal  @default(0) @db.Decimal(12, 2) // Return denominator
  avgDeployedCapital    Decimal  @default(0) @db.Decimal(12, 2)
  dataQuality           String   @default("sufficient") // Data quality flag
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  
  @@unique([date, templateId])
  @@index([templateId, date])
}

model SiteMetricDay {
  id                  String   @id @default(cuid())
  date                DateTime @db.Date @unique
  usersActive         Int      @default(0)
  templatesActive     Int      @default(0)
  botsActive          Int      @default(0)
  totalTrades         Int      @default(0)
  grossPnl            Decimal  @default(0) @db.Decimal(12, 2)
  totalVolume         Decimal  @default(0) @db.Decimal(15, 2)
  newUsers            Int      @default(0)
  churnedUsers        Int      @default(0)
  systemDailyReturn   Decimal  @default(0) @db.Decimal(8, 6)
  systemSharpe        Decimal  @default(0) @db.Decimal(5, 2)
  totalDeployedCapital Decimal @default(0) @db.Decimal(15, 2)
  
  @@index([date])
}

// Worker-refreshed current metrics table (MySQL-friendly)
model TemplateMetricCurrent {
  id                  String   @id @default(cuid())
  templateId          String   @unique
  totalTrades         Int      @default(0)
  winningTrades       Int      @default(0)
  totalPnl            Decimal  @default(0) @db.Decimal(12, 2)
  annualReturn        Decimal  @default(0) @db.Decimal(8, 4) // Based on allocated capital
  winRate             Decimal  @default(0) @db.Decimal(5, 2)
  sharpeRatio         Decimal  @default(0) @db.Decimal(5, 2) // From daily equity returns
  maxDrawdown         Decimal  @default(0) @db.Decimal(5, 2)
  activeUsers         Int      @default(0)
  last30dReturn       Decimal  @default(0) @db.Decimal(8, 4)
  avgDeployedCapital  Decimal  @default(0) @db.Decimal(12, 2)
  dataQuality         String   @default("insufficient_data") // Truth label
  lastUpdated         DateTime @default(now())
  
  @@index([templateId])
}

// Worker watermark tracking
model MetricWatermark {
  id                  String   @id @default(cuid())
  metricType          String   // 'template', 'site', 'user'
  lastProcessedAt     DateTime @default(now())
  lastProcessedId     String?
  isDirty             Boolean  @default(false) // For nightly recalculation
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  
  @@unique([metricType])
}
```

**Same source facts. Different group by.**

### 3. Hybrid MVP Schedule

**Event-Driven + Nightly Processing:**

```javascript
// Immediate updates on execution fills
export async function onExecutionFilled(execution) {
  // 1. Write fact (append-only, version aware)
  await insertTradeFact(execution)
  
  // 2. Update simple aggregates immediately
  await updateTemplateSimpleMetrics(execution.templateId, {
    tradeCount: '+1',
    totalPnl: `+${execution.pnl}`,
    winRate: execution.pnl > 0 ? 'recalculate' : 'unchanged'
  })
  
  // 3. Mark template dirty for nightly complex calculations
  await markTemplateDirty(execution.templateId)
}

// Nightly complex calculations (2:00 AM local)
export async function nightlyMetricRecalculation() {
  const dirtyTemplates = await getDirtyTemplates()
  
  for (const templateId of dirtyTemplates) {
    // Calculate expensive metrics from daily aggregates
    const metrics = await calculateComplexMetrics(templateId)
    
    // Update current snapshot table
    await updateTemplateCurrent(templateId, metrics)
    
    // Clear dirty flag
    await markTemplateClean(templateId)
  }
}
```

**Watermark Strategy (Safe):**
```javascript
// Use processed flag, not executionId
const unprocessedFacts = await prisma.tradeMetricFact.findMany({
  where: { processed: false },
  orderBy: { createdAt: 'asc' },
  take: 100 // Batch processing
})

// Transactional claim
await prisma.$transaction(async (tx) => {
  const facts = await tx.tradeMetricFact.findMany({
    where: { processed: false },
    orderBy: { createdAt: 'asc' },
    take: 100
  })
  
  // Mark as processing immediately
  await tx.tradeMetricFact.updateMany({
    where: { id: { in: facts.map(f => f.id) } },
    data: { processed: true }
  })
  
  // Process facts...
})
```

### 4. Worker-Refreshed Current Metrics

**MySQL-friendly approach (no materialized views):**

```javascript
// Worker refreshes template_metric_current table nightly
export async function refreshTemplateCurrent(templateId) {
  const last365Days = await prisma.templateMetricDay.findMany({
    where: {
      templateId,
      date: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }
    },
    orderBy: { date: 'asc' }
  })
  
  // Calculate rolling metrics from daily data
  const rolling = calculateRollingMetrics(last365Days)
  
  // Determine data quality
  const dataQuality = assessDataQuality(last365Days)
  
  // Upsert to current table
  await prisma.templateMetricCurrent.upsert({
    where: { templateId },
    update: {
      ...rolling,
      dataQuality,
      lastUpdated: new Date()
    },
    create: {
      templateId,
      ...rolling,
      dataQuality,
      lastUpdated: new Date()
    }
  })
}
```

**Proper Sharpe Calculation:**
```javascript
// Use daily equity returns, not per-trade returns
function calculateSharpe(dailyReturns) {
  const meanReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length
  const stdDev = Math.sqrt(variance)
  
  // Annualized Sharpe (252 trading days)
  return (meanReturn * 252) / (stdDev * Math.sqrt(252))
}
```

## Why This Architecture Wins

**Instead of recalculating Sharpe 50 ways:**
- User profile uses `UserDailyMetrics`
- Template page uses `TemplateDailyMetrics` 
- Admin dashboard uses `SiteDailyMetrics`

**One source. Many consumers.**

### Benefits

1. **Never Calculate Twice** - Each execution processed once
2. **Metric Lineage** - Can audit why Sharpe changed (fact → day → current)
3. **Incremental** - Only new data, no full table scans
4. **Scalable** - Performance stays constant with data growth
5. **Extensible** - Add new metrics without touching core logic
6. **Debuggable** - Clear data flow from fact to aggregate

### 5. Data Quality & Truth Labels

**Assess Data Quality Before Showing Metrics:**

```javascript
function assessDataQuality(dailyData) {
  const totalDays = dailyData.length
  const activeUsers = new Set(dailyData.map(d => d.userId)).size
  const totalTrades = dailyData.reduce((sum, d) => sum + d.totalTrades, 0)
  
  if (totalDays < 30) return 'insufficient_data'
  if (activeUsers < 3) return 'sample_size_low'
  if (totalTrades < 50) return 'insufficient_trades'
  if (isVolatile(dailyData)) return 'volatile'
  if (totalDays < 90) return 'new_template'
  
  return 'sufficient'
}

function isVolatile(dailyData) {
  const returns = dailyData.map(d => d.dailyEquityReturn).filter(r => r !== 0)
  const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - mean(returns), 2), 0) / returns.length)
  return stdDev > 0.05 // 5% daily volatility threshold
}
```

**Truth Labels for UI:**
- `insufficient_data` - "Not enough data yet"
- `new_template` - "New template - building track record"  
- `sample_size_low` - "Limited user base"
- `volatile` - "High volatility - use caution"
- `sufficient` - Show full metrics

**Frontend Display Logic:**
```jsx
const getMetricDisplay = (metrics, quality) => {
  if (quality !== 'sufficient') {
    return {
      annualReturn: '—',
      winRate: '—', 
      sharpeRatio: '—',
      message: getQualityMessage(quality)
    }
  }
  
  return {
    annualReturn: `${metrics.annualReturn}%`,
    winRate: `${metrics.winRate}%`,
    sharpeRatio: metrics.sharpeRatio.toFixed(2)
  }
}
```

## Worker Sidecar Integration

**Perfect place for metrics processing.** Your worker already handles asynchronous jobs.

**Add to worker responsibilities:**
```javascript
// metrics_worker.js
export async function processExecutionFill(execution) {
  // 1. Create trade fact
  const fact = createTradeFact(execution)
  await prisma.tradeMetricFact.create({ data: fact })
  
  // 2. Update daily aggregates
  await updateTemplateDaily(execution.date, execution.templateId)
  await updateSiteDaily(execution.date)
  
  // 3. Trigger materialized view refresh (async)
  await scheduleViewRefresh()
}
```

**Consumes:**
- executions filled
- snapshot close  
- bot enabled/disabled
- deposits/withdrawals

## API Design

**Template Metrics Endpoint (with truth labels):**
```javascript
// GET /api/templates/:templateId/metrics
const metrics = await prisma.templateMetricCurrent.findUnique({
  where: { templateId }
})

// Don't show unreliable metrics
if (metrics.dataQuality !== 'sufficient') {
  return {
    templateId,
    dataQuality: metrics.dataQuality,
    message: getQualityMessage(metrics.dataQuality),
    metrics: {
      annualReturn: null,
      winRate: null,
      sharpeRatio: null,
      activeUsers: metrics.activeUsers,
      totalTrades: metrics.totalTrades,
      lastUpdated: metrics.lastUpdated
    }
  }
}

return {
  templateId,
  dataQuality: metrics.dataQuality,
  metrics: {
    annualReturn: metrics.annualReturn,
    winRate: metrics.winRate,
    sharpeRatio: metrics.sharpeRatio,
    maxDrawdown: metrics.maxDrawdown,
    activeUsers: metrics.activeUsers,
    totalTrades: metrics.totalTrades,
    last30dReturn: metrics.last30dReturn,
    lastUpdated: metrics.lastUpdated
  }
}
```

**Enhanced Catalog Endpoint:**
```javascript
// GET /api/bots/catalog (add metrics field)
const templates = await prisma.botTemplate.findMany({
  include: {
    metrics: {
      select: {
        annualReturn: true,
        winRate: true,
        sharpeRatio: true,
        dataQuality: true,
        activeUsers: true,
        totalTrades: true
      }
    }
  }
})
```

## Smart MVP Implementation Plan

### Day 1: Foundation Schema
```sql
-- Create trade_metric_fact table (version aware)
-- Create template_metric_day table  
-- Create template_metric_current table
-- Create metric_watermark table
-- Add proper indexes for performance
```

### Day 2: Event-Driven Worker
```javascript
// Add metrics processing to existing worker
// Implement processed flag watermark
// Create fact insertion logic
// Add dirty flag marking for templates
```

### Day 3: Nightly Processing
```javascript
// Implement nightly complex metric calculation
// Update template_metric_current from daily data
// Add data quality assessment
// Clear dirty flags
```

### Day 4: Template Metrics API
```javascript
// GET /api/templates/:templateId/metrics
// Enhanced catalog endpoint with truth labels
// Graceful handling of insufficient data
// Cache control headers (24h for complex metrics)
```

### Day 5: Frontend Integration
```jsx
// Update TemplateDetails.jsx with quality-aware metrics
// Add truth label messaging
// Show "Building track record" for new templates
// Add loading states and error handling
```

### Week 2: Expansion (Optional)
- User metrics dashboard
- Admin site metrics  
- Leaderboards and rankings

## Strategic Insights

**You're no longer building just a trading app.** You're building a quant SaaS platform with telemetry requirements. Metrics architecture now matters as much as order execution.

**Key MVP Principles:**
1. **Event-driven immediate updates** for simple metrics (trade count, P&L, win rate)
2. **Nightly complex calculations** for expensive metrics (Sharpe, annual returns, drawdown)
3. **Truth labels** prevent users from trusting unreliable early data
4. **Denominator discipline** ensures return percentages are meaningful

**Why This Approach Wins for an MVP:**
- **Low churn**: No constant background processing when there's no activity
- **Trustworthy data**: Quality gates prevent showing misleading metrics
- **Simple scaling**: Add user metrics later without rearchitecting
- **Production ready**: Handles execution corrections and partial fills

## Final Recommendation

Start with 4 core tables:
- `trade_metric_fact` (version-aware, append-only)
- `template_metric_day` (daily aggregates)
- `template_metric_current` (worker-refreshed snapshots)
- `metric_watermark` (processing tracking)

**Hybrid schedule:**
- **Event-driven**: Update simple metrics on fills
- **Nightly 2AM**: Recalculate complex metrics for dirty templates only
- **On-demand**: Refresh if metrics older than 24h when requested

This gives you trustworthy template performance immediately while building a foundation that scales to user metrics, admin dashboards, and advanced analytics without rearchitecting.

**Build one reusable metrics engine now and every future dashboard becomes cheap.**

## User Portfolio Attribution System

### The Real Metrics Problem

Template KPIs are easy. User portfolio KPIs are messy because users blend behaviors:

- Alpaca manual trades
- Template bots  
- Custom rule engines
- Multiple bots simultaneously
- Deposits/withdrawals
- Idle cash
- Strategy changes over time

### Decision Attribution Architecture

**Every execution must carry decision source:**

```sql
model TradeMetricFact {
  // ... existing fields ...
  sourceType          String   // 'MANUAL' | 'TEMPLATE' | 'CUSTOM_RULE' | 'ML_SIGNAL' | 'REBALANCE' | 'UNKNOWN'
  sourceId            String?  // templateId, botId, strategyId, userActionId
  sourceName          String?  // "Golden Cross", "Manual NVDA Trade", etc.
  sessionId           String?  // For grouping related decisions
  
  // Cash flow events (separate from trades)
  eventType           String   // 'fill' | 'deposit' | 'withdrawal' | 'transfer'
  cashFlowAmount      Decimal? @db.Decimal(12, 2) // Positive for deposits, negative for withdrawals
  portfolioValue      Decimal? @db.Decimal(12, 2) // Portfolio value after event
}
```

**Critical: Add to Execution table now:**
```sql
model Execution {
  // ... existing fields ...
  sourceType          String   @default("UNKNOWN")
  sourceId            String?
  templateId          String?  // Keep for backward compatibility
  botId               String?
  isManual            Boolean  @default(false)
}
```

### User Portfolio KPI Dashboard

**Row 1 - Main KPIs:**
- Portfolio Return (time-weighted)
- Today P&L
- Win Rate  
- Sharpe Ratio
- Max Drawdown

**Row 2 - Attribution Breakdown:**
```
Bot Strategies: 62% (+$9.1k)
Manual Trades: 38% (+$3.4k)
Custom Rules: 0% (+$0)
```

**Row 3 - Top Contributors:**
- Best Strategy: Golden Cross (+$7.8k)
- Worst Strategy: Manual Options (-$1.2k)
- Best Symbol: SPY (+$5.2k)
- Worst Symbol: NVDA (-$2.1k)

### Attribution Calculation Logic

```javascript
// Calculate attribution by source type (resolve names at query time)
async function calculateAttribution(userId, period) {
  const facts = await prisma.tradeMetricFact.findMany({
    where: {
      userId,
      date: { gte: period.start, lte: period.end },
      eventType: 'fill' // Only trades, not cash flows
    }
  })
  
  // Group by decision source
  const attribution = facts.reduce((acc, fact) => {
    const key = `${fact.sourceType}:${fact.sourceId || 'null'}`
    acc[key] = acc[key] || {
      sourceType: fact.sourceType,
      sourceId: fact.sourceId,
      pnl: 0,
      trades: 0,
      wins: 0
    }
    
    acc[key].pnl += Number(fact.pnl)
    acc[key].trades += 1
    if (fact.isWin) acc[key].wins += 1
    
    return acc
  }, {})
  
  // Resolve source names and calculate percentages
  const totalPnl = Object.values(attribution).reduce((sum, a) => sum + a.pnl, 0)
  const results = await Promise.all(Object.values(attribution).map(async a => {
    let sourceName = 'Unknown'
    
    // Resolve name at query time, not stored
    if (a.sourceType === 'TEMPLATE' && a.sourceId) {
      const template = await prisma.botTemplate.findUnique({ where: { id: a.sourceId } })
      sourceName = template?.name || 'Unknown Template'
    } else if (a.sourceType === 'MANUAL') {
      sourceName = 'Manual Trades'
    } else if (a.sourceType === 'CUSTOM_RULE' && a.sourceId) {
      sourceName = 'Custom Rules'
    }
    
    return {
      ...a,
      sourceName,
      contribution: totalPnl !== 0 ? (a.pnl / totalPnl) * 100 : 0,
      winRate: a.trades > 0 ? (a.wins / a.trades) * 100 : 0
    }
  }))
  
  return results
}
```

### Handling Cash Events

**Time-Weighted Return for deposits/withdrawals:**
```javascript
// Fixed TWR calculation - chain sub-period returns correctly
async function calculateTimeWeightedReturn(userId, period) {
  const events = await prisma.tradeMetricFact.findMany({
    where: {
      userId,
      date: { gte: period.start, lte: period.end }
    },
    orderBy: { createdAt: 'asc' }
  })
  
  let startValue = events[0]?.portfolioValue || 0
  let twr = 1.0
  
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    
    if (event.eventType === 'deposit' || event.eventType === 'withdrawal') {
      // End value BEFORE this cash flow
      const endValueBeforeCashFlow = event.portfolioValue - event.cashFlowAmount
      
      // Sub-period return: endValueBeforeCashFlow / startValue - 1
      const subPeriodReturn = startValue !== 0 ? (endValueBeforeCashFlow / startValue) - 1 : 0
      
      // Chain the returns
      twr *= (1 + subPeriodReturn)
      
      // New start value is portfolio value after cash flow
      startValue = event.portfolioValue
    }
  }
  
  // Handle final period if last event wasn't a cash flow
  const finalEvent = events[events.length - 1]
  if (finalEvent && finalEvent.eventType === 'fill') {
    const finalReturn = startValue !== 0 ? (finalEvent.portfolioValue / startValue) - 1 : 0
    twr *= (1 + finalReturn)
  }
  
  return ((twr - 1) * 100) // Annualized percentage
}
```

### UNKNOWN Source Handling (UI Contract)

**Rule: UNKNOWN gets excluded from attribution but included in totals**

```javascript
// Attribution display logic
function formatAttributionForUI(attribution, totalReturn) {
  const knownSources = attribution.filter(a => a.sourceType !== 'UNKNOWN')
  const unknownPnl = attribution.find(a => a.sourceType === 'UNKNOWN')?.pnl || 0
  
  // Attribution donut only shows known sources
  const attributionData = knownSources.map(a => ({
    name: a.sourceName,
    value: a.contribution,
    pnl: a.pnl
  }))
  
  // But total return includes everything
  const displayReturn = totalReturn
  
  return {
    attribution: attributionData,
    totalReturn: displayReturn,
    hasUnknownData: unknownPnl !== 0,
    unknownPnl
  }
}
```

**UI Message:** "Unclassified trades excluded from attribution breakdown"

### MVP Implementation Plan

**Step 1: Schema Updates (Day 1)**
- Add `sourceType`, `sourceId`, `isManual` to Execution table
- Backfill existing executions as `sourceType: 'UNKNOWN'`
- Add cash flow event handling

**Step 2: Portfolio KPI Card (Day 2)**
- Total return, Sharpe, drawdown calculations
- Time-weighted return handling
- Cash flow adjustment logic

**Step 3: Attribution Donut Chart (Day 3)**
- Group trades by decision source
- Calculate contribution percentages
- Show "Bots vs Manual" initially

**Step 4: Per-Source Drilldown (Day 4)**
- Tap attribution slice → isolated KPIs
- Template performance within user context
- Manual trade performance analysis

### Lean MVP Scope (What to Cut)

**Keep (Essential):**
- Unified fact model
- Template KPIs with truth labels
- User portfolio KPIs (total return, Sharpe, drawdown)
- Source attribution (MANUAL, TEMPLATE, CUSTOM_RULE, UNKNOWN)
- Nightly heavy calculations
- Snapshot tables (template_metric_current)
- Event-driven simple updates

**Cut for Now (Overbuilt):**
- Versioned correction engine (use delete-and-reinsert for rare cases)
- Complex TWR calculations (use simple return until users ask)
- Multi-layer watermark processor (simple processed flag works)
- Session lineage (sessionId undefined - drop entirely)
- Daily volatility truth classifier for user portfolios (condescending)
- Per-source Sharpe ratio (statistically noisy at user level)
- UserMetricDay tables (compute behavior KPIs on-demand initially)
- Over-detailed data quality taxonomy for users

**Future Additions (When Needed):**
- TWR when users complain return looks wrong after deposits
- Correction engine when broker actually sends corrected fills
- UserMetricDay when behavior KPIs become performance bottleneck
- Session grouping when you have clear definition

### Strategic Moat

**Most brokers show balances. You can show why balances changed.**

Every trade answers:
- Human decision
- Template decision  
- Custom logic decision
- Signal decision

This attribution system becomes your competitive advantage - users will optimize behavior based on seeing "my manual trades are dragging down my overall return."

### Critical Implementation Notes

1. **Never contaminate template KPIs** with user manual trades
2. **Backfill attribution early** - impossible to reconstruct later  
3. **Handle UNKNOWN sources** - exclude from attribution, include in totals
4. **Simple returns first** - add TWR when users demand accuracy
5. **Decision lineage** more valuable than raw metrics

The unified pipeline architecture supports this perfectly - same fact table, different attribution dimensions.
