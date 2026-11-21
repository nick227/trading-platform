import prisma from '../loaders/prisma.js'
import { authenticate } from '../middleware/authenticate.js'
import { encrypt } from '../utils/encryption.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { getUserAlpacaCredentialsOrThrow } from '../services/alpacaClockService.js'
import { getReconcileStatus, reconcileBrokerActivity } from '../services/brokerReconciliationService.js'

async function fetchAlpacaAccount(userId) {
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

  // GET /api/account — account summary for authenticated user
  fastify.get('/', async (request, reply) => {
    try {
      const userId = request.user.id
      const [alpaca, executions] = await Promise.all([
        fetchAlpacaAccount(userId),
        prisma.execution.findMany({
          where:   { userId },
          orderBy: { createdAt: 'desc' }
        })
      ])

      const totalPnL      = executions.reduce((s, e) => s + Number(e.pnl ?? 0), 0)
      const winningTrades = executions.filter(e => Number(e.pnl ?? 0) > 0).length
      const winRate       = executions.length > 0 ? (winningTrades / executions.length) * 100 : 0

      return reply.send({
        equity:         alpaca ? parseFloat(alpaca.equity)       : null,
        buying_power:   alpaca ? parseFloat(alpaca.buying_power) : null,
        cash:           alpaca ? parseFloat(alpaca.cash)         : null,
        total_pnl:      totalPnL,
        win_rate:       winRate,
        total_trades:   executions.length,
        winning_trades: winningTrades
      })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/account/positions — filled positions for authenticated user
  fastify.get('/positions', async (request, reply) => {
    try {
      const userId = request.user.id
      const executions = await prisma.execution.findMany({
        where:   { userId, status: 'filled' },
        orderBy: { createdAt: 'asc' }
      })

      const positions = {}
      for (const e of executions) {
        const pos       = positions[e.ticker] ?? { quantity: 0, totalCost: 0 }
        const fillPrice = e.filledPrice ?? e.price ?? 0
        if (e.direction === 'buy') {
          positions[e.ticker] = { quantity: pos.quantity + e.quantity, totalCost: pos.totalCost + fillPrice * e.quantity }
        } else {
          const remaining = Math.max(0, pos.quantity - e.quantity)
          const ratio     = pos.quantity > 0 ? remaining / pos.quantity : 0
          positions[e.ticker] = { quantity: remaining, totalCost: pos.totalCost * ratio }
        }
      }

      return reply.send(
        Object.entries(positions)
          .filter(([, pos]) => pos.quantity > 0)
          .map(([ticker, pos]) => ({
            symbol:         ticker,
            quantity:       pos.quantity,
            avg_price:      pos.quantity > 0 ? pos.totalCost / pos.quantity : 0,
            cost_basis:     pos.totalCost,
            unrealized_pnl: 0
          }))
      )
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
    const broker = await prisma.brokerAccount.findUnique({ where: { userId: String(userId) } })
    if (!broker) return reply.send({ connected: false })
    return reply.send({ connected: true, paper: broker.paper, status: broker.status, lastVerifiedAt: broker.lastVerifiedAt })
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
