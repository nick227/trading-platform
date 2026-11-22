import prisma from '../loaders/prisma.js'
import { authenticate } from '../middleware/authenticate.js'
import { encrypt } from '../utils/encryption.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { getUserAlpacaCredentialsOrThrow } from '../services/alpacaClockService.js'
import { getReconcileStatus, reconcileBrokerActivity } from '../services/brokerReconciliationService.js'
import { simulationConfig } from '../services/simulationService.js'
import { valuePortfolio, valueHistory } from '../services/portfolioValuationService.js'

async function fetchAlpacaAccount(userId) {
  // Simulator mode never contacts Alpaca.
  if (simulationConfig().enabled) return null
  let creds
  try {
    creds = await getUserAlpacaCredentialsOrThrow(userId)
  } catch {
    return null
  }

  try {
    const res = await fetch(`${creds.baseUrl}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': creds.apiKey,
        'APCA-API-SECRET-KEY': creds.apiSecret
      }
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function accountRoutes(fastify) {
  // Enforce authentication across all account routes
  fastify.addHook('preHandler', authenticate)

  // GET /api/account — account summary for authenticated user (authoritative valuation)
  fastify.get('/', async (request, reply) => {
    try {
      const userId = request.user.id
      const v = await valuePortfolio(userId, { fetchBrokerAccount: fetchAlpacaAccount })
      return reply.send({
        equity:         v.equity,
        buying_power:   v.cash !== null ? Math.max(0, v.cash) : null,
        cash:           v.cash,
        total_pnl:      v.totalPnl,
        realized_pnl:   v.realizedPnl,
        unrealized_pnl: v.unrealizedPnl,
        total_trades:   v.fillCount,
        source:         v.source,
        prices_as_of:   v.pricesAsOf,
      })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/account/valuation — full portfolio valuation (summary + holdings + bot attribution)
  fastify.get('/valuation', async (request, reply) => {
    try {
      return reply.send({ data: await valuePortfolio(request.user.id, { fetchBrokerAccount: fetchAlpacaAccount }) })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/account/value-history — the user's own daily portfolio value series
  fastify.get('/value-history', async (request, reply) => {
    try {
      const range = ['1M', '3M', '6M', '1Y'].includes(request.query?.range) ? request.query.range : '3M'
      return reply.send({ data: await valueHistory(request.user.id, { range }) })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/account/positions — open holdings valued at the latest known close
  fastify.get('/positions', async (request, reply) => {
    try {
      const v = await valuePortfolio(request.user.id, { fetchBrokerAccount: fetchAlpacaAccount })
      return reply.send(v.positions.map((p) => ({
        symbol:         p.symbol,
        quantity:       p.quantity,
        avg_price:      p.avgPrice,
        cost_basis:     p.costBasis,
        current_price:  p.price,
        price_session:  p.priceSession,
        market_value:   p.marketValue,
        unrealized_pnl: p.unrealizedPnl,
      })))
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // POST /api/account/broker-credentials — save or update Alpaca keys for the logged-in user
  fastify.post('/broker-credentials', async (request, reply) => {
    const { apiKey, apiSecret, paper = true } = request.body ?? {}
    if (!apiKey || !apiSecret) {
      return reply.code(400).send({ error: 'apiKey and apiSecret are required' })
    }

    const userId = request.user.id

    // Verify credentials against Alpaca before saving
    const base = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'
    try {
      const verifyRes = await fetch(`${base}/v2/account`, {
        headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret }
      })
      if (!verifyRes.ok) {
        return reply.code(400).send({ error: 'Invalid Alpaca credentials — verification failed' })
      }
    } catch {
      return reply.code(502).send({ error: 'Could not reach Alpaca to verify credentials' })
    }

    const encryptedKey    = encrypt(apiKey)
    const encryptedSecret = encrypt(apiSecret)

    const now = new Date()
    await prisma.brokerAccount.upsert({
      where:  { userId },
      update: { apiKey: encryptedKey, apiSecret: encryptedSecret, paper, status: 'active', lastVerifiedAt: now },
      create: {
        id:            generateId(ID_PREFIXES.BROKER),
        userId,
        broker:        'alpaca',
        apiKey:        encryptedKey,
        apiSecret:     encryptedSecret,
        paper,
        status:        'active',
        lastVerifiedAt: now
      }
    })

    return reply.send({ ok: true, paper })
  })

  // GET /api/account/broker-credentials — check if broker account is connected
  fastify.get('/broker-credentials', async (request, reply) => {
    const userId = request.user.id
    const sim = simulationConfig()
    if (sim.enabled) {
      const v = await valuePortfolio(userId)
      return reply.send({
        connected: true, paper: true, simulated: true, mode: sim.mode, session: sim.session, status: 'simulated',
        lastVerifiedAt: null, accountNumber: null, equity: v.equity, cash: v.cash, buyingPower: v.cash !== null ? Math.max(0, v.cash) : null,
      })
    }
    const broker = await prisma.brokerAccount.findUnique({ where: { userId: String(userId) } })
    if (!broker) return reply.send({ connected: false })

    const alpaca = await fetchAlpacaAccount(userId)
    return reply.send({
      connected: true,
      paper: broker.paper,
      status: broker.status,
      lastVerifiedAt: broker.lastVerifiedAt,
      accountNumber: alpaca?.account_number ?? null,
      equity: alpaca ? parseFloat(alpaca.equity) : null,
      cash: alpaca ? parseFloat(alpaca.cash) : null,
      buyingPower: alpaca ? parseFloat(alpaca.buying_power) : null,
    })
  })

  // DELETE /api/account/broker-credentials — disconnect broker account
  fastify.delete('/broker-credentials', async (request, reply) => {
    const userId = request.user.id
    await prisma.brokerAccount.deleteMany({ where: { userId: String(userId) } })
    return reply.send({ ok: true })
  })

  fastify.get('/reconcile-status', async (request, reply) => {
    const userId = request.user.id
    const status = await getReconcileStatus(String(userId))
    return reply.send(status)
  })

  fastify.post('/reconcile', async (request, reply) => {
    const userId = request.user.id
    try {
      const result = await reconcileBrokerActivity(String(userId))
      return reply.send(result)
    } catch (error) {
      if (error?.code === 'BROKER_NOT_CONFIGURED' || error?.code === 'BROKER_CREDENTIALS_INVALID') {
        return reply.code(403).send({ error: error.message })
      }
      if (error?.code === 'LIVE_TRADING_DISABLED') {
        return reply.code(403).send({ error: error.message })
      }
      return reply.code(503).send({ error: 'Broker reconciliation failed', detail: error.message })
    }
  })
}
