import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { encrypt } from '../../src/utils/encryption.js'
import executionsService from '../../src/services/executionsService.js'
import botsService from '../../src/services/botsService.js'

// In-memory test store for bots, rules, events, executions
const db = {
  users: new Map(),
  portfolios: new Map(),
  brokerAccounts: new Map(),
  templates: new Map(),
  bots: new Map(),
  rules: new Map(),
  events: [],
  executions: []
}

function resetDb() {
  db.users.clear()
  db.portfolios.clear()
  db.brokerAccounts.clear()
  db.templates.clear()
  db.bots.clear()
  db.rules.clear()
  db.events = []
  db.executions = []

  // Seed Users
  db.users.set('usr_alice', {
    id: 'usr_alice',
    email: 'alice@example.com',
    fullName: 'Alice Trader',
    subscription: { status: 'ACTIVE' }
  })
  db.users.set('usr_bob', {
    id: 'usr_bob',
    email: 'bob@example.com',
    fullName: 'Bob Investor',
    subscription: { status: 'ACTIVE' }
  })

  // Seed Portfolios
  db.portfolios.set('por_alice', { id: 'por_alice', userId: 'usr_alice', name: 'Alice Portfolio' })
  db.portfolios.set('por_bob', { id: 'por_bob', userId: 'usr_bob', name: 'Bob Portfolio' })

  // Seed Broker Accounts
  db.brokerAccounts.set('usr_alice', {
    id: 'bro_alice',
    userId: 'usr_alice',
    apiKey: encrypt('alice_key'),
    apiSecret: encrypt('alice_secret'),
    paper: true,
    status: 'active'
  })
  db.brokerAccounts.set('usr_bob', {
    id: 'bro_bob',
    userId: 'usr_bob',
    apiKey: encrypt('bob_key'),
    apiSecret: encrypt('bob_secret'),
    paper: true,
    status: 'active'
  })

  // Seed Templates
  const templates = [
    {
      id: 'tmpl_momentum_buy',
      name: 'Momentum Buy',
      description: 'Buys a ticker when price rises above a threshold.',
      botType: 'rule_based',
      config: { direction: 'buy', quantity: 1, tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000 },
      rules: [
        { name: 'Market Hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
        { name: 'Price Above Threshold', type: 'price_threshold', config: { direction: 'above', operator: 'above', price: 0 } },
        { name: 'Position Limit', type: 'position_limit', config: { maxShares: 100, maxQuantity: 100 } }
      ]
    },
    {
      id: 'tmpl_dca_accumulator',
      name: 'DCA Accumulator',
      description: 'Dollar-cost averages into a position.',
      botType: 'rule_based',
      config: { direction: 'buy', quantity: 1, tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000 },
      rules: [
        { name: 'Market Hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } }
      ]
    }
  ]
  for (const t of templates) db.templates.set(t.id, t)
}

vi.mock('../../src/loaders/prisma.js', () => ({
  default: {
    $transaction: vi.fn(async (cb) => {
      const tx = {
        bot: {
          create: vi.fn(async ({ data }) => {
            const bot = { ...data, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }
            db.bots.set(bot.id, bot)
            return bot
          })
        },
        botRule: {
          createMany: vi.fn(async ({ data }) => {
            for (const r of data) {
              db.rules.set(r.id, { ...r, createdAt: new Date(), updatedAt: new Date() })
            }
            return { count: data.length }
          })
        }
      }
      return cb(tx)
    }),
    user: {
      findUnique: vi.fn(async ({ where }) => db.users.get(where?.id) ?? null)
    },
    brokerAccount: {
      findUnique: vi.fn(async ({ where }) => db.brokerAccount?.get?.(where?.userId) ?? db.brokerAccounts.get(where?.userId) ?? null)
    },
    portfolio: {
      findUnique: vi.fn(async ({ where }) => db.portfolios.get(where?.id) ?? null),
      findFirst: vi.fn(async ({ where }) => {
        for (const p of db.portfolios.values()) {
          if (where?.userId && p.userId === where.userId) return p
        }
        return null
      }),
      findMany: vi.fn(async ({ where }) => {
        const res = []
        for (const p of db.portfolios.values()) {
          if (!where?.userId || p.userId === where.userId) res.push(p)
        }
        return res
      }),
      count: vi.fn(async () => db.portfolios.size)
    },
    botTemplate: {
      findMany: vi.fn(async ({ where }) => {
        const res = []
        for (const t of db.templates.values()) {
          if (!where?.botType || t.botType === where.botType) res.push(t)
        }
        return res
      }),
      findUnique: vi.fn(async ({ where }) => db.templates.get(where?.id) ?? null),
      count: vi.fn(async () => db.templates.size)
    },
    bot: {
      create: vi.fn(async ({ data }) => {
        const bot = { ...data, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }
        db.bots.set(bot.id, bot)
        return bot
      }),
      findUnique: vi.fn(async ({ where }) => {
        const bot = db.bots.get(where?.id)
        if (!bot) return null
        const rules = []
        for (const r of db.rules.values()) {
          if (r.botId === bot.id) rules.push(r)
        }
        return { ...bot, rules }
      }),
      findFirst: vi.fn(async ({ where }) => {
        for (const b of db.bots.values()) {
          if (where?.id && b.id !== where.id) continue
          if (where?.userId && b.userId !== where.userId) continue
          if (where?.deletedAt === null && b.deletedAt !== null) continue
          return b
        }
        return null
      }),
      findMany: vi.fn(async ({ where }) => {
        const res = []
        for (const b of db.bots.values()) {
          if (where?.userId && b.userId !== where.userId) continue
          if (where?.deletedAt === null && b.deletedAt !== null) continue
          res.push({
            ...b,
            portfolio: db.portfolios.get(b.portfolioId),
            _count: { executions: 0, events: 0, rules: 0 }
          })
        }
        return res
      }),
      count: vi.fn(async ({ where }) => {
        let count = 0
        for (const b of db.bots.values()) {
          if (where?.userId && b.userId !== where.userId) continue
          if (where?.deletedAt === null && b.deletedAt !== null) continue
          count++
        }
        return count
      }),
      update: vi.fn(async ({ where, data }) => {
        const existing = db.bots.get(where?.id)
        if (!existing) {
          const err = new Error('Record to update not found')
          err.code = 'P2025'
          throw err
        }
        const updated = { ...existing, ...data, updatedAt: new Date() }
        db.bots.set(where.id, updated)
        return updated
      })
    },
    botRule: {
      createMany: vi.fn(async ({ data }) => {
        for (const r of data) {
          db.rules.set(r.id, { ...r, createdAt: new Date(), updatedAt: new Date() })
        }
        return { count: data.length }
      }),
      findMany: vi.fn(async ({ where }) => {
        const res = []
        for (const r of db.rules.values()) {
          if (!where?.botId || r.botId === where.botId) res.push(r)
        }
        return res
      }),
      count: vi.fn(async ({ where }) => {
        let c = 0
        for (const r of db.rules.values()) {
          if (!where?.botId || r.botId === where.botId) c++
        }
        return c
      })
    },
    botEvent: {
      create: vi.fn(async ({ data }) => {
        const evt = { id: data.id || `evt_${Date.now()}`, ...data, createdAt: new Date() }
        db.events.push(evt)
        return evt
      }),
      findMany: vi.fn(async ({ where, take = 50 }) => {
        let res = db.events.filter(e => {
          if (where?.botId && e.botId !== where.botId) return false
          if (where?.type && e.type !== where.type) return false
          return true
        })
        res.sort((a, b) => b.createdAt - a.createdAt)
        return res.slice(0, take)
      }),
      count: vi.fn(async ({ where }) => {
        return db.events.filter(e => {
          if (where?.botId && e.botId !== where.botId) return false
          if (where?.type && e.type !== where.type) return false
          return true
        }).length
      })
    },
    execution: {
      create: vi.fn(async ({ data }) => {
        const exe = { id: data.id || `exe_${Date.now()}`, ...data, createdAt: new Date() }
        db.executions.push(exe)
        return exe
      }),
      findMany: vi.fn(async ({ where, take = 50 }) => {
        let res = db.executions.filter(x => {
          if (where?.userId && x.userId !== where.userId) return false
          if (where?.botId && x.botId !== where.botId) return false
          return true
        })
        res.sort((a, b) => b.createdAt - a.createdAt)
        return res.slice(0, take)
      }),
      findUnique: vi.fn(async ({ where }) => db.executions.find(x => x.id === where?.id) ?? null),
      count: vi.fn(async ({ where }) => {
        return db.executions.filter(x => {
          if (where?.userId && x.userId !== where.userId) return false
          return true
        }).length
      }),
      aggregate: vi.fn(async () => ({ _count: db.executions.length, _sum: { quantity: 10 } })),
      groupBy: vi.fn(async () => [])
    },
    executionAudit: {
      create: vi.fn(async ({ data }) => ({ id: `aud_${Date.now()}`, ...data }))
    }
  }
}))

vi.mock('../../src/services/alpacaClockService.js', () => ({
  getUserAlpacaCredentialsOrThrow: vi.fn().mockResolvedValue({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    paper: true,
    baseUrl: 'https://paper-api.alpaca.markets'
  }),
  fetchAlpacaMarketClock: vi.fn().mockResolvedValue({
    isOpen: true,
    nextOpen: new Date().toISOString(),
    nextClose: new Date().toISOString()
  })
}))

import createApp from '../../src/loaders/fastify.js'
import registerRoutes from '../../src/loaders/routes.js'

let app
let tokenAlice
let tokenBob

describe('Complete Multi-User Bot Lifecycle Integration Test', () => {
  beforeEach(async () => {
    resetDb()
    vi.clearAllMocks()

    process.env.INTERNAL_READ_KEY = '7f4c2a91d8e63b5f0c1a7e94b2d65f3a9c8e1f47b6d2c0ea95f13b7d4a6e8c21'
    process.env.ALLOW_LIVE_TRADING = 'false'

    app = await createApp()
    await registerRoutes(app)
    await app.ready()

    tokenAlice = app.jwt.sign({ sub: 'usr_alice' })
    tokenBob = app.jwt.sign({ sub: 'usr_bob' })
  })

  afterEach(async () => {
    await app.close()
  })

  it('executes the full 10-step bot lifecycle with isolation and event audit trail', async () => {
    // ── 1. Authenticate & Query Template Catalog ─────────────────────────────────────
    const catalogRes = await request(app.server)
      .get('/api/bots/catalog')
      .set('Cookie', [`access_token=${tokenAlice}`])
      .expect(200)

    expect(catalogRes.body.data.ruleBased).toBeDefined()
    expect(catalogRes.body.data.ruleBased.length).toBeGreaterThanOrEqual(1)
    const template = catalogRes.body.data.ruleBased.find(t => t.id === 'tmpl_momentum_buy')
    expect(template).toBeDefined()
    expect(template.botType).toBe('rule_based')

    // ── 2. Create Bot Transactionally (Paused by default) ────────────────────────────
    const createRes = await request(app.server)
      .post('/api/bots/catalog/from-template')
      .set('Cookie', [`access_token=${tokenAlice}`])
      .send({
        templateId: 'tmpl_momentum_buy',
        portfolioId: 'por_alice',
        name: 'Alice SPY Momentum Bot',
        tickers: ['SPY'],
        capital: 5000,
        allocatedAmount: 5000,
        maxPerOrder: 1000,
        maxOrderNotional: 1000,
        capitalMode: 'allocated',
        direction: 'buy',
        enabled: false
      })
      .expect(201)

    const botId = createRes.body.data.id
    expect(botId).toBeDefined()
    expect(createRes.body.data.enabled).toBe(false) // Verified paused by default
    expect(createRes.body.data.config.allocatedAmount).toBe(5000)
    expect(createRes.body.data.config.maxOrderNotional).toBe(1000)
    expect(createRes.body.data.config.direction).toBe('buy')
    expect(createRes.body.data.rules).toHaveLength(3)

    // ── 3. Verify Bot Persistence and Ownership ──────────────────────────────────────
    const botGetRes = await request(app.server)
      .get(`/api/bots/${botId}`)
      .set('Cookie', [`access_token=${tokenAlice}`])
      .expect(200)

    expect(botGetRes.body.data.id).toBe(botId)
    expect(botGetRes.body.data.enabled).toBe(false)
    expect(botGetRes.body.data.userId).toBe('usr_alice')

    // ── 4. Activate Bot Explicitly & Verify Lifecycle Event ──────────────────────────
    const activateRes = await request(app.server)
      .put(`/api/bots/${botId}`)
      .set('Cookie', [`access_token=${tokenAlice}`])
      .send({ enabled: true })
      .expect(200)

    expect(activateRes.body.data.enabled).toBe(true)

    // Verify bot_resumed event was persisted
    const resumedEvent = db.events.find(e => e.botId === botId && e.type === 'bot_resumed')
    expect(resumedEvent).toBeDefined()
    expect(resumedEvent.metadata.enabled).toBe(true)

    // ── 5. Simulate Market Execution & Order Creation ────────────────────────────────
    // Worker / engine execution test: create execution and audit log
    const execRes = await executionsService.createExecution({
      userId: 'usr_alice',
      portfolioId: 'por_alice',
      botId,
      ticker: 'SPY',
      direction: 'buy',
      quantity: 10,
      price: 100,
      commission: 0,
      fees: 0
    })

    const executionId = execRes.id
    expect(executionId).toBeDefined()
    expect(execRes.origin).toBe('bot')

    // ── 6. Log Decision & Skip Events (Verified Enum Values) ─────────────────────────
    await botsService.createBotEvent({
      botId,
      portfolioId: 'por_alice',
      type: 'decision_made',
      detail: 'Signal generated: buy for SPY',
      metadata: { signal: 'buy', ticker: 'SPY', confidence: 0.8 }
    })

    await botsService.createBotEvent({
      botId,
      portfolioId: 'por_alice',
      type: 'execution_skipped',
      detail: 'Position limit reached for SPY',
      metadata: { reason: 'position_limit_reached', ticker: 'SPY' }
    })

    // ── 7. Retrieve Activity Timeline & Verify Events ────────────────────────────────
    const eventsRes = await request(app.server)
      .get(`/api/bots/${botId}/events`)
      .set('Cookie', [`access_token=${tokenAlice}`])
      .expect(200)

    expect(eventsRes.body.data.length).toBeGreaterThanOrEqual(3)
    const types = eventsRes.body.data.map(e => e.type)
    expect(types).toContain('bot_resumed')
    expect(types).toContain('decision_made')
    expect(types).toContain('execution_skipped')

    // ── 8. Pause Bot & Verify Lifecycle Event ────────────────────────────────────────
    const pauseRes = await request(app.server)
      .put(`/api/bots/${botId}`)
      .set('Cookie', [`access_token=${tokenAlice}`])
      .send({ enabled: false })
      .expect(200)

    expect(pauseRes.body.data.enabled).toBe(false)
    const pausedEvent = db.events.find(e => e.botId === botId && e.type === 'bot_paused')
    expect(pausedEvent).toBeDefined()
    expect(pausedEvent.metadata.enabled).toBe(false)

    // ── 9. Multi-User Isolation & Security Enforcement ──────────────────────────────
    // Bob cannot read Alice's bot
    await request(app.server)
      .get(`/api/bots/${botId}`)
      .set('Cookie', [`access_token=${tokenBob}`])
      .expect(404)

    // Bob cannot modify Alice's bot
    await request(app.server)
      .put(`/api/bots/${botId}`)
      .set('Cookie', [`access_token=${tokenBob}`])
      .send({ name: 'Hacked by Bob' })
      .expect(404)

    // Bob cannot read Alice's bot events
    await request(app.server)
      .get(`/api/bots/${botId}/events`)
      .set('Cookie', [`access_token=${tokenBob}`])
      .expect(404)

    // Unauthenticated request to /api/executions is rejected with 401
    await request(app.server)
      .get('/api/executions')
      .expect(401)

    // Bob only sees Bob's executions, not Alice's
    const bobExecsRes = await request(app.server)
      .get('/api/executions')
      .set('Cookie', [`access_token=${tokenBob}`])
      .expect(200)

    expect(bobExecsRes.body.data).toHaveLength(0)

    // ── 10. Stop (Delete) Bot & Verify Soft Delete ───────────────────────────────────
    await request(app.server)
      .delete(`/api/bots/${botId}`)
      .set('Cookie', [`access_token=${tokenAlice}`])
      .expect(204)

    const stoppedBot = db.bots.get(botId)
    expect(stoppedBot.deletedAt).toBeDefined()
    expect(stoppedBot.deletedAt).not.toBeNull()

    const stoppedEvent = db.events.find(e => e.botId === botId && e.type === 'bot_stopped')
    expect(stoppedEvent).toBeDefined()
    expect(stoppedEvent.metadata.stopped).toBe(true)
  })
})
