import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { encrypt } from '../../src/utils/encryption.js'
import createApp from '../../src/loaders/fastify.js'
import registerRoutes from '../../src/loaders/routes.js'
import { calculateFifoAccounting, calculateFillPnl } from '../../src/services/botAccountingService.js'

// In-memory test store
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

  // Users
  db.users.set('usr_alice', { id: 'usr_alice', email: 'alice@example.com', subscription: { status: 'ACTIVE' } })
  db.users.set('usr_bob', { id: 'usr_bob', email: 'bob@example.com', subscription: { status: 'ACTIVE' } })

  // Portfolios
  db.portfolios.set('por_alice', { id: 'por_alice', userId: 'usr_alice', name: 'Alice Portfolio' })
  db.portfolios.set('por_bob', { id: 'por_bob', userId: 'usr_bob', name: 'Bob Portfolio' })

  // Broker Accounts
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

  // Template
  db.templates.set('tmpl_momentum_buy', {
    id: 'tmpl_momentum_buy',
    name: 'Momentum Buy',
    botType: 'rule_based',
    config: {
      direction: 'buy',
      quantity: 10,
      tickers: ['SPY'],
      allocatedAmount: 5000,
      maxOrderNotional: 1000
    },
    rules: [
      { name: 'Market Hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
      { name: 'Price Rule', type: 'price_threshold', config: { direction: 'above', threshold: 100 } }
    ]
  })
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
      findUnique: vi.fn(async ({ where }) => db.brokerAccounts.get(where?.userId) ?? null)
    },
    portfolio: {
      findUnique: vi.fn(async ({ where }) => db.portfolios.get(where?.id) ?? null),
      findFirst: vi.fn(async ({ where }) => {
        for (const p of db.portfolios.values()) {
          if (where?.userId && p.userId === where.userId) return p
        }
        return null
      })
    },
    botTemplate: {
      findUnique: vi.fn(async ({ where }) => db.templates.get(where?.id) ?? null)
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
          const err = new Error('Record not found')
          err.code = 'P2025'
          throw err
        }
        const updated = { ...existing, ...data, updatedAt: new Date() }
        db.bots.set(where.id, updated)
        return updated
      })
    },
    botRule: {
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
          if (where?.status?.in && !where.status.in.includes(x.status)) return false
          if (where?.filledQuantity?.gt !== undefined && !(x.filledQuantity > where.filledQuantity.gt)) return false
          if (where?.filledPrice?.gt !== undefined && !(x.filledPrice > where.filledPrice.gt)) return false
          if (where?.id?.not && x.id === where.id.not) return false
          return true
        })
        res.sort((a, b) => (new Date(a.filledAt || a.createdAt)) - (new Date(b.filledAt || b.createdAt)))
        return res.slice(0, take)
      }),
      findUnique: vi.fn(async ({ where }) => db.executions.find(x => x.id === where?.id) ?? null),
      update: vi.fn(async ({ where, data }) => {
        const idx = db.executions.findIndex(x => x.id === where.id)
        if (idx === -1) throw new Error('Execution not found')
        db.executions[idx] = { ...db.executions[idx], ...data, updatedAt: new Date() }
        return db.executions[idx]
      })
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

describe('Operational Bot Runtime - Verification Suite', () => {
  let app
  let tokenAlice
  let tokenBob

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

  it('verifies complete lifecycle: creation, execution fills, PnL accounting, user isolation, and pause/stop controls', async () => {
    // 1. Alice creates bot from template
    const createRes = await request(app.server)
      .post('/api/bots/catalog/from-template')
      .set('Authorization', `Bearer ${tokenAlice}`)
      .send({
        templateId: 'tmpl_momentum_buy',
        name: 'Alice SPY Momentum',
        portfolioId: 'por_alice',
        enabled: true,
        capital: 5000,
        maxPerOrder: 1000
      })
    expect(createRes.status).toBe(201)
    const botAlice = createRes.body.data
    expect(botAlice.name).toBe('Alice SPY Momentum')
    expect(botAlice.rules).toHaveLength(2)

    // 2. Initial state: no fills, performance and capital in use are null
    const getInitialRes = await request(app.server)
      .get(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenAlice}`)
    expect(getInitialRes.status).toBe(200)
    expect(getInitialRes.body.data.performance).toBeNull()
    expect(getInitialRes.body.data.capitalInUse).toBeNull()

    // 3. User isolation: Bob cannot view or act on Alice's bot
    const bobAccessRes = await request(app.server)
      .get(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenBob}`)
    expect(bobAccessRes.status).toBe(404)

    const bobPauseRes = await request(app.server)
      .put(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenBob}`)
      .send({ enabled: false })
    expect(bobPauseRes.status).toBe(404)

    // 4. Simulate Buy Fill: 10 SPY @ $100 (Cost basis $1,000, fee $1.00)
    const buyExec = {
      id: 'exe_buy_1',
      userId: 'usr_alice',
      portfolioId: 'por_alice',
      botId: botAlice.id,
      ticker: 'SPY',
      direction: 'buy',
      quantity: 10,
      price: 100,
      status: 'filled',
      filledQuantity: 10,
      filledPrice: 100,
      fees: 1.0,
      pnl: 0,
      filledAt: new Date('2026-11-20T10:00:00Z'),
      createdAt: new Date('2026-11-20T10:00:00Z')
    }
    db.executions.push(buyExec)

    // Verify accounting after buy: Realized PnL is 0, capital in use is 1000, unrealized is null when unvalued
    const getAfterBuyRes = await request(app.server)
      .get(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenAlice}`)
    expect(getAfterBuyRes.status).toBe(200)
    expect(getAfterBuyRes.body.data.capitalInUse).toBe(1000)
    expect(getAfterBuyRes.body.data.performance).toMatchObject({
      realizedPnl: 0,
      unrealizedPnl: null,
      totalPnl: null,
      fees: 1.0
    })

    // 5. Simulate Sell Fill: 10 SPY @ $115 (Gain = 10 * (115 - 100) = $150, fee $1.00)
    // Order worker uses calculateFillPnl to calculate authoritative realized P/L
    const sellPnl = await calculateFillPnl({
      execution: {
        id: 'exe_sell_1',
        userId: 'usr_alice',
        portfolioId: 'por_alice',
        botId: botAlice.id,
        ticker: 'SPY',
        direction: 'sell',
        quantity: 10,
        price: 115
      },
      fillPrice: 115,
      fillQty: 10
    })
    expect(sellPnl).toBe(150)

    const sellExec = {
      id: 'exe_sell_1',
      userId: 'usr_alice',
      portfolioId: 'por_alice',
      botId: botAlice.id,
      ticker: 'SPY',
      direction: 'sell',
      quantity: 10,
      price: 115,
      status: 'filled',
      filledQuantity: 10,
      filledPrice: 115,
      fees: 1.0,
      pnl: sellPnl,
      filledAt: new Date('2026-11-20T11:00:00Z'),
      createdAt: new Date('2026-11-20T11:00:00Z')
    }
    db.executions.push(sellExec)

    // Verify accounting after full exit: position is closed, capital in use is 0, realized PnL = 150
    const getAfterSellRes = await request(app.server)
      .get(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenAlice}`)
    expect(getAfterSellRes.status).toBe(200)
    expect(getAfterSellRes.body.data.capitalInUse).toBe(0)
    expect(getAfterSellRes.body.data.performance).toMatchObject({
      realizedPnl: 150,
      unrealizedPnl: 0,
      totalPnl: 150,
      fees: 2.0
    })

    // 6. Pause Bot -> records bot_paused event and sets enabled: false
    const pauseRes = await request(app.server)
      .put(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenAlice}`)
      .send({ enabled: false })
    expect(pauseRes.status).toBe(200)
    expect(pauseRes.body.data.enabled).toBe(false)

    // 7. Resume Bot -> records bot_resumed event and sets enabled: true
    const resumeRes = await request(app.server)
      .put(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenAlice}`)
      .send({ enabled: true })
    expect(resumeRes.status).toBe(200)
    expect(resumeRes.body.data.enabled).toBe(true)

    // 8. Delete (Stop) Bot -> soft deletes bot and records bot_stopped event
    const stopRes = await request(app.server)
      .delete(`/api/bots/${botAlice.id}`)
      .set('Authorization', `Bearer ${tokenAlice}`)
    expect(stopRes.status).toBe(204)

    // Verify lifecycle events persisted
    const eventsRes = await request(app.server)
      .get(`/api/bots/${botAlice.id}/events`)
      .set('Authorization', `Bearer ${tokenAlice}`)
    expect(eventsRes.status).toBe(200)
    const eventTypes = eventsRes.body.data.map(e => e.type)
    expect(eventTypes).toContain('bot_paused')
    expect(eventTypes).toContain('bot_resumed')
    expect(eventTypes).toContain('bot_stopped')
  })
})
