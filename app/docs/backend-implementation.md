# Backend Implementation Guide

## Tech Stack
- **Framework**: Fastify (Node.js)
- **ORM**: Prisma
- **API Spec**: OpenAPI 3.0 (auto-generated)
- **Architecture**: Loaders pattern (declarative, generic)

## Project Structure
```
src/
  loaders/           # Declarative setup
    prisma.js
    fastify.js
    routes.js
    swagger.js
  routes/            # API endpoints
    strategies.js
    predictions.js
    bots/
      index.js
      rules.js
      events.js
    executions.js
    portfolios.js
  services/          # Business logic
    strategiesService.js
    predictionsService.js
    botsService.js
    executionsService.js
    portfoliosService.js
  utils/             # Shared utilities
    idGenerator.js
    pagination.js
    validation.js
prisma/
  schema.prisma      # Database schema
```

## 1. Database Schema (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Direction {
  buy
  sell
}

enum ExecutionStatus {
  proposed
  filled
  cancelled
}

enum BotEventType {
  rule_triggered
  decision_made
  execution_created
  execution_skipped
  error_occurred
}

enum BotRuleType {
  price_threshold
  position_limit
  daily_loss
  market_hours
}

model Strategy {
  id          String   @id
  name        String
  description String
  type        String
  createdAt   DateTime @default(now())

  predictions Prediction[]
  bots       Bot[]

  @@index([type])
}

model Prediction {
  id           String    @id
  strategyId   String
  ticker       String
  direction    Direction
  confidence   Float
  entryPrice   Float
  stopPrice    Float
  targetPrice  Float
  createdAt    DateTime  @default(now())
  regime       String
  reasoning    String

  strategy   Strategy   @relation(fields: [strategyId], references: [id])
  executions Execution[]

  @@index([ticker, createdAt])
  @@index([strategyId])
}

model User {
  id           String      @id
  email        String      @unique
  passwordHash String?     // null during stub phase, required for JWT
  createdAt    DateTime    @default(now())
  
  portfolios Portfolio[]
  bots       Bot[]
}

model Portfolio {
  id        String      @id
  userId    String
  name      String
  createdAt DateTime    @default(now())

  user       User        @relation(fields: [userId], references: [id])
  executions Execution[]
  bots       Bot[]

  @@index([createdAt])
  @@index([userId])
}

model Bot {
  id           String     @id
  userId       String
  portfolioId  String
  strategyId   String
  name         String
  enabled      Boolean    @default(true)
  config       Json       // Bot configuration
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  deletedAt    DateTime?  // Soft delete

  user       User       @relation(fields: [userId], references: [id])
  portfolio Portfolio @relation(fields: [portfolioId], references: [id])
  strategy  Strategy  @relation(fields: [strategyId], references: [id])
  rules     BotRule[]
  events    BotEvent[]
  executions Execution[]

  @@index([portfolioId])
  @@index([enabled])
  @@index([userId])
}

model BotRule {
  id        String     @id
  botId     String
  name      String
  type      BotRuleType
  config    Json       // Typed config based on type
  enabled   Boolean    @default(true)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  bot Bot @relation(fields: [botId], references: [id])

  @@index([botId, enabled])
}

model BotEvent {
  id          String      @id
  botId       String
  portfolioId String      // Denormalized for performance
  ruleId      String?
  executionId String?
  type        BotEventType
  detail      String
  metadata    Json?       // Structured context
  createdAt   DateTime    @default(now())

  bot       Bot       @relation(fields: [botId], references: [id])
  execution Execution? @relation(fields: [executionId], references: [id])

  @@index([botId, createdAt])
  @@index([portfolioId, createdAt])
  @@index([executionId])
  @@index([type])
}

model Execution {
  id            String          @id
  portfolioId   String
  strategyId    String
  predictionId  String?
  botId         String?
  ticker        String
  direction     Direction
  quantity      Float
  price         Float
  status        ExecutionStatus
  commission    Float
  fees          Float
  createdAt     DateTime        @default(now())

  portfolio  Portfolio  @relation(fields: [portfolioId], references: [id])
  strategy   Strategy   @relation(fields: [strategyId], references: [id])
  prediction Prediction? @relation(fields: [predictionId], references: [id])
  bot        Bot?       @relation(fields: [botId], references: [id])

  @@index([portfolioId, createdAt])
  @@index([ticker, createdAt])
  @@index([strategyId])
  @@index([botId, createdAt])
}
```

## 2. Loaders Setup

### `src/loaders/prisma.js`
```javascript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  log: ['query', 'error', 'warn']
})

export default prisma
```

### `src/loaders/fastify.js`
```javascript
import fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

export default async function createApp() {
  const app = fastify({
    logger: true
  })

  // Swagger setup
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Alpha Trader API',
        version: '1.0.0'
      }
    }
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs'
  })

  return app
}
```

### `src/loaders/routes.js`
```javascript
import strategiesRoutes from '../routes/strategies.js'
import predictionsRoutes from '../routes/predictions.js'
import botRoutes from '../routes/bots/index.js'
import executionRoutes from '../routes/executions.js'
import portfolioRoutes from '../routes/portfolios.js'

export default async function registerRoutes(app) {
  await app.register(strategiesRoutes, { prefix: '/api/strategies' })
  await app.register(predictionsRoutes, { prefix: '/api/predictions' })
  await app.register(botRoutes, { prefix: '/api/bots' })
  await app.register(executionRoutes, { prefix: '/api/executions' })
  await app.register(portfolioRoutes, { prefix: '/api/portfolios' })
}
```

## 3. Utilities

### `src/utils/idGenerator.js`
```javascript
import { randomUUID } from 'crypto'

export function generateId(prefix) {
  const timestamp = Date.now()
  const uuid = randomUUID().slice(0, 8)
  return `${prefix}_${timestamp}_${uuid}`
}

export function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

export const ID_PREFIXES = {
  PREDICTION: 'prd',
  EXECUTION: 'exe',
  STRATEGY: 'str',
  PORTFOLIO: 'prt',
  BOT: 'bot',
  EVENT: 'evt',
  RULE: 'rul'
}
```

### `src/utils/auth.js`
```javascript
export const STUB_USER_ID = 'usr_stub_demo'
```

### `src/utils/validation.js`
```javascript
function validateEventMetadata(type, metadata) {
  switch (type) {
    case 'rule_triggered':
      if (!metadata.ticker || !metadata.actualPrice || !metadata.ruleId) {
        throw new Error('rule_triggered event requires ticker, actualPrice, and ruleId')
      }
      break
    case 'decision_made':
      if (!metadata.confidence || !metadata.modelVersion || !metadata.regime || !metadata.strategyId) {
        throw new Error('decision_made event requires confidence, modelVersion, regime, and strategyId')
      }
      break
    case 'execution_created':
      if (!metadata.executionId || !metadata.quantity || !metadata.price || !metadata.direction) {
        throw new Error('execution_created event requires executionId, quantity, price, and direction')
      }
      break
    case 'execution_skipped':
      if (!metadata.reason) {
        throw new Error('execution_skipped event requires reason')
      }
      break
    case 'error_occurred':
      if (!metadata.code || !metadata.message) {
        throw new Error('error_occurred event requires code and message')
      }
      break
    default:
      throw new Error(`Unknown event type: ${type}`)
  }
}

export { validateEventMetadata }
```

### `src/utils/pagination.js`
```javascript
export function buildOffsetPagination(query) {
  const { offset = 0, limit = 50 } = query
  const take = Math.min(parseInt(limit), 100)
  const skip = Math.max(parseInt(offset), 0)
  
  return { take, skip }
}

export function buildExecutionWhere(query) {
  const { portfolioId, strategyId, botId, ticker, direction, status, dateFrom, dateTo, after } = query
  const where = {}
  if (portfolioId) where.portfolioId = portfolioId
  if (strategyId) where.strategyId = strategyId
  if (botId) where.botId = botId
  if (ticker) where.ticker = ticker
  if (direction) where.direction = direction
  if (status) where.status = status
  
  // Handle date filters
  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) where.createdAt.gte = new Date(parseInt(dateFrom))
    if (dateTo) where.createdAt.lte = new Date(parseInt(dateTo))
  }
  
  // Apply cursor filter - use pipe delimiter to avoid underscore conflicts
  if (after) {
    const [cursorDate, cursorId] = after.split('|')
    
    // Preserve existing date filters if any
    const existingDateFilter = where.createdAt || {}
    
    where.OR = [
      { createdAt: { lt: new Date(parseInt(cursorDate)) } },
      { 
        createdAt: new Date(parseInt(cursorDate)),
        id: { lt: cursorId }
      }
    ]
    
    // Apply date filters to both OR conditions
    if (Object.keys(existingDateFilter).length > 0) {
      where.OR = where.OR.map(condition => ({
        ...condition,
        createdAt: {
          ...existingDateFilter,
          ...condition.createdAt
        }
      }))
    }
  }
  
  return where
}
```

## 4. Service Pattern

### `src/services/predictionsService.js`
```javascript
import { engineClient } from '../clients/engine.js'
import { ID_PREFIXES, simpleHash } from '../utils/idGenerator.js'

function mapPrediction(raw) {
  // Stable, collision-safe ID using hash of stable input
  const stable = {
    timestamp: raw.timestamp,
    ticker: raw.ticker,
    strategyId: raw.strategyId,
    prediction: raw.prediction
  }
  const hash = simpleHash(JSON.stringify(stable))
  const id = raw.id ?? `${ID_PREFIXES.PREDICTION}_${raw.timestamp}_${raw.ticker}_${raw.strategyId}_${hash}`
  
  return {
    id,
    strategyId: raw.strategyId,
    ticker: raw.ticker,
    direction: raw.prediction === 'UP' ? 'buy' : 'sell',
    confidence: raw.confidence,
    entryPrice: raw.entryPrice,
    stopPrice: raw.stopPrice ?? null,
    targetPrice: raw.targetPrice ?? null,
    predictedAt: (() => {
      const ts = Number(raw.timestamp)
      return Number.isFinite(ts) ? ts : new Date(raw.timestamp).getTime()
    })(),
    regime: raw.regime ?? 'unknown',
    reasoning: raw.reasoning ?? ''
  }
}

export default {
  async getPredictions(query) {
    const raw = await engineClient.getPredictions(query)
    
    // Dedupe predictions by ID to prevent duplicates
    const seen = new Set()
    const data = raw
      .map(mapPrediction)
      .filter(p => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
    
    return {
      data,
      pagination: {
        hasMore: false,
        nextCursor: null
      }
    }
  },

  async getPredictionById(id) {
    // TODO: replace with direct engine lookup when GET /internal/predictions/:id is available
    // Current implementation fetches all predictions and filters in memory - fine for POC but inefficient at scale
    const { data } = await this.getPredictions({})
    return data.find(p => p.id === id) || null
  }
}
```
```

### `src/services/executionsService.js`
```javascript
import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { validateEventMetadata } from '../utils/validation.js'
import { buildExecutionWhere } from '../utils/pagination.js'

export default {
  async createExecution(data) {
    const execution = await prisma.execution.create({
      data: {
        id: generateId(ID_PREFIXES.EXECUTION),
        ...data,
        direction: data.direction.toLowerCase(), // Normalize direction input
        status: 'proposed'
      }
    })
    
    // Create bot event if automated
    if (data.botId) {
      const eventType = 'execution_created'
      const metadata = {
        executionId: execution.id,
        quantity: data.quantity,
        price: data.price,
        direction: data.direction
      }
      
      validateEventMetadata(eventType, metadata)
      
      await prisma.botEvent.create({
        data: {
          id: generateId(ID_PREFIXES.EVENT),
          botId: data.botId,
          portfolioId: data.portfolioId,
          executionId: execution.id,
          type: eventType,
          detail: `Created ${data.direction} order for ${data.ticker}`,
          metadata
        }
      })
    }
    
    return execution
  },

  async getExecutions(query) {
    const where = buildExecutionWhere(query)
    const take = Math.min(parseInt(query.limit || 50), 100)
    
    const executions = await prisma.execution.findMany({
      where,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      take: take + 1 // Get one extra to determine next cursor
    })
    
    const hasMore = executions.length > take
    const results = hasMore ? executions.slice(0, -1) : executions
    
    const nextCursor = hasMore && results.length > 0
      ? `${results[results.length - 1].createdAt.getTime()}|${results[results.length - 1].id}`
      : null
    
    return { data: results, pagination: { hasMore, nextCursor } }
  },

  async getExecution(id) {
    return prisma.execution.findUnique({ where: { id } })
  },

  async getExecutionSummary(query) {
    const where = buildExecutionWhere(query)
    
    // Use aggregation for accurate totals (better at scale)
    const [aggregate, countResult, latest, oldest] = await Promise.all([
      prisma.execution.aggregate({
        where,
        _count: true,
        _sum: { quantity: true }
      }),
      prisma.execution.groupBy({
        where,
        by: ['direction'],
        _count: true
      }),
      prisma.execution.findFirst({
        where,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.execution.findFirst({
        where,
        orderBy: { createdAt: 'asc' }
      })
    ])
    
    const directionCounts = countResult.reduce((acc, group) => {
      acc[group.direction] = group._count
      return acc
    }, {})
    
    const summary = {
      totalExecutions: aggregate._count,
      buyExecutions: directionCounts.buy || 0,
      sellExecutions: directionCounts.sell || 0,
      winRate: 0, // Calculate based on sell prices vs avg cost
      totalVolume: aggregate._sum.quantity || 0,
      avgExecutionSize: aggregate._count > 0 ? (aggregate._sum.quantity || 0) / aggregate._count : 0,
      latestExecution: latest,
      oldestExecution: oldest
    }
    
    return summary
  }
}
```

## 5. Route Pattern

### `src/routes/executions.js`
```javascript
import executionsService from '../services/executionsService.js'

export default async function executionsRoutes(app, opts) {
  // GET /api/executions/summary - must come before /:id
  app.get('/summary', async (request, reply) => {
    const summary = await executionsService.getExecutionSummary(request.query)
    return reply.send({ data: summary })
  })

  // GET /api/executions
  app.get('/', async (request, reply) => {
    const result = await executionsService.getExecutions(request.query)
    return reply.send(result)
  })

  // GET /api/executions/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params
    const execution = await executionsService.getExecution(id)
    if (!execution) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } })
    }
    return { data: execution }
  })

  // POST /api/executions
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['ticker', 'direction', 'quantity', 'price', 'portfolioId', 'strategyId'],
        properties: {
          ticker: { type: 'string' },
          direction: { enum: ['buy', 'sell'] },
          quantity: { type: 'number', minimum: 0 },
          price: { type: 'number', minimum: 0 },
          portfolioId: { type: 'string' },
          strategyId: { type: 'string' },
          predictionId: { type: 'string' },
          botId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const execution = await executionsService.createExecution(request.body)
    return reply.code(201).send({ data: execution })
  })
}
```

### `src/routes/predictions.js`
```javascript
import predictionsService from '../services/predictionsService.js'

export default async function predictionsRoutes(app, opts) {
  app.get('/', async (request, reply) => {
    const result = await predictionsService.getPredictions(request.query)
    return reply.send(result)
  })

  app.get('/:id', async (request, reply) => {
    const item = await predictionsService.getPredictionById(request.params.id)
    if (!item) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Prediction not found' } })
    }
    return { data: item }
  })
}
```

## 6. Main Entry Point

### `src/server.js`
```javascript
import createApp from './loaders/fastify.js'
import registerRoutes from './loaders/routes.js'
import prisma from './loaders/prisma.js'

async function start() {
  const app = await createApp()
  
  await registerRoutes(app)
  
  const signals = ['SIGINT', 'SIGTERM']
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`Received ${signal}, shutting down gracefully`)
      await app.close()
      await prisma.$disconnect()
      process.exit(0)
    })
  })
  
  try {
    await app.listen({ port: 3000 })
    console.log('Server listening on http://localhost:3000')
    console.log('API docs available at http://localhost:3000/docs')
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
```

## 7. Development Setup

### `package.json`
```json
{
  "scripts": {
    "dev": "tsx watch src/server.js",
    "build": "tsc",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@fastify/swagger": "^8.0.0",
    "@fastify/swagger-ui": "^2.0.0",
    "@prisma/client": "^5.0.0",
    "fastify": "^4.0.0",
    "prisma": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

## 8. OpenAPI Generation

The Fastify + Swagger setup automatically generates OpenAPI specs at:
- **JSON Spec**: `http://localhost:3000/docs/json`
- **Interactive Docs**: `http://localhost:3000/docs`

## 9. Engine Client

### `src/clients/engine.js`
```javascript
const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:8000'

export const engineClient = {
  async getPredictions(params = {}) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null))
    ).toString()
    const res = await fetch(`${ENGINE_URL}/internal/predictions?${qs}`)
    if (!res.ok) throw new Error(`Engine ${res.status}: ${await res.text()}`)
    return res.json()
  },

  async getStrategies() {
    const res = await fetch(`${ENGINE_URL}/internal/strategies`)
    if (!res.ok) throw new Error(`Engine ${res.status}: ${await res.text()}`)
    return res.json()
  },

  async getCurrentPrices() {
    const res = await fetch(`${ENGINE_URL}/internal/prices/current`)
    if (!res.ok) throw new Error(`Engine ${res.status}: ${await res.text()}`)
    return res.json()
  }
}

## 10. Implementation Phases

### Phase 0 - Environment Setup (One-time)
1. **Environment Setup**
   - MySQL running locally
   - `.env` file with `DATABASE_URL` and `ENGINE_URL`
   - Alpha-engine running on port 8000
   
2. **Database Schema**
   - Add User model + userId to Portfolio/Bot
   - `prisma db push`
   - Seed stub user: `{ id: 'usr_stub_demo', email: 'demo@example.com', passwordHash: null }`
   
3. **Internal Engine Endpoints** (Real data, ~20 lines each)
   ```python
   # alpha-engine/src/internal/routes.py
   @router.get("/predictions")
   async def get_predictions(ticker: str = None, limit: int = 100):
       where = {"ticker": ticker} if ticker else {}
       return await db.prediction.find_many(where=where, order={"createdAt": "desc"}, take=limit)
   
   @router.get("/strategies")  
   async def get_strategies():
       return await db.strategy.find_many(where={"active": True})
   
   @router.get("/prices/current")
   async def get_current_prices():
       tickers = await db.pricebar.find_many(distinct=["ticker"], order={"timestamp": "desc"})
       return {t.ticker: t.close for t in tickers}
   ```

### Phase 1 - Core Trading Loop
4. **Core Loaders + Utilities**
   - Loaders (prisma, fastify, routes)
   - Utilities (pagination, idGenerator, auth, validation)
   
5. **Portfolios + Executions**
   - Portfolios service + router (with userId filtering)
   - Executions service + router (with userId filtering, real prices)
   - Positions service (FIFO computation with real prices from engine)
   
6. **Validate Core Loop**
   - Create portfolio (with STUB_USER_ID)
   - Record executions (with real prices from engine)
   - Compute positions (with real P&L)

### Phase 2 - Engine Integration + Bots
7. **Engine Client + Predictions**
   - Engine client wired to real endpoints
   - Predictions router (native adapter)
   - Strategies router (reads engine)
   
8. **Bots + Rules + Events** (Same sprint)
   - Bots service + router (with userId)
   - Bot rules service + router
   - Bot events service + router
   - Wire execution -> event creation
   
9. **Validate Full Flow**
   - Prediction from engine
   - Bot fires based on rule
   - Execution created
   - Event logged

### Phase 3 - Production
10. **Real Authentication**
    - Replace STUB_USER_ID with JWT claims
    - Add JWT middleware
    - Multi-tenant isolation
    
11. **Deployment**
    - Deploy engine to Railway + Postgres migration
    - Deploy platform pointing at engine DB/internal API
    - End-to-end validation

**Environment Variables Needed**:
```bash
DATABASE_URL="mysql://root:password@localhost:3306/trading_platform"
ENGINE_URL="http://localhost:8000"
PORT=3000
```

## 11. MySQL Notes

- **JSON Support**: MySQL 5.7+ supports JSON column type
- **Enums**: Native enum support in MySQL
- **PlanetScale**: MySQL-compatible but no foreign key constraints
- **Connection**: `mysql://root:password@localhost:3306/trading_platform`

## 10. Key Principles

- **Single Source of Truth**: Prisma schema = API contract = Database
- **Declarative Setup**: Loaders pattern for clean initialization
- **Type Safety**: Full TypeScript + Prisma types
- **Auto-Documentation**: OpenAPI generated from route schemas
- **Minimal Boilerplate**: Service pattern with Prisma client
- **Performance**: Proper indexing and cursor pagination

This setup gives you a production-ready API that perfectly aligns with the contract and frontend requirements.
