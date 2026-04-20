import prisma from '../loaders/prisma.js'
import { STUB_USER_ID } from '../utils/auth.js'
import { authenticate } from '../middleware/authenticate.js'
import { encrypt, decrypt } from '../utils/encryption.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'

const ALPACA_BASE = 'https://paper-api.alpaca.markets'

async function fetchAlpacaAccount() {
  const apiKey    = process.env.ALPACA_API_KEY
  const apiSecret = process.env.ALPACA_API_SECRET
  if (!apiKey || !apiSecret) return null

  try {
    const res = await fetch(`${ALPACA_BASE}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID':     apiKey,
        'APCA-API-SECRET-KEY': apiSecret
      }
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function accountRoutes(fastify) {
  // Development bypass - remove in production
  const isDev = process.env.NODE_ENV !== 'production'

  // GET /api/account — account summary
  fastify.get('/', async (request, reply) => {
    try {
      const [alpaca, executions] = await Promise.all([
        fetchAlpacaAccount(),
        prisma.execution.findMany({
          where:   { userId: STUB_USER_ID },
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

  // GET /api/account/positions
  fastify.get('/positions', async (request, reply) => {
    try {
      const executions = await prisma.execution.findMany({
        where:   { userId: STUB_USER_ID, status: 'filled' },
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
  fastify.post('/broker-credentials', { 
    preHandler: isDev ? [] : [authenticate]  // Development bypass
  }, async (request, reply) => {
    console.log('Broker credentials POST - request received')
    console.log('Request body keys:', Object.keys(request.body || {}))
    
    const { apiKey, apiSecret, paper = true } = request.body ?? {}
    if (!apiKey || !apiSecret) {
      return reply.code(400).send({ error: 'apiKey and apiSecret are required' })
    }

    // Development bypass - use a stub user ID if not authenticated
    const userId = request.user?.id || (isDev ? '1' : null)
    
    if (!userId) {
      return reply.code(401).send({ error: 'User authentication required' })
    }
    
    console.log('Processing broker credentials for user:', userId)

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

    const existing = await prisma.brokerAccount.findUnique({ where: { userId } })
    if (existing) {
      await prisma.brokerAccount.update({
        where: { userId },
        data:  { apiKey: encryptedKey, apiSecret: encryptedSecret, paper, status: 'active', lastVerifiedAt: new Date() }
      })
    } else {
      await prisma.brokerAccount.create({
        data: {
          id:            generateId(ID_PREFIXES.BROKER),
          userId,
          broker:        'alpaca',
          apiKey:        encryptedKey,
          apiSecret:     encryptedSecret,
          paper,
          status:        'active',
          lastVerifiedAt: new Date()
        }
      })
    }

    return reply.send({ ok: true, paper })
  })

  // GET /api/account/broker-credentials — check if broker account is connected
  fastify.get('/broker-credentials', { 
    preHandler: isDev ? [] : [authenticate]  // Development bypass
  }, async (request, reply) => {
    console.log('Broker credentials GET - request received')
    
    // Development bypass - use a stub user ID if not authenticated
    const userId = request.user?.id || (isDev ? '1' : null)
    
    if (!userId) {
      return reply.code(401).send({ error: 'User authentication required' })
    }
    
    console.log('Checking broker credentials for user:', userId)
    
    const broker = await prisma.brokerAccount.findUnique({ where: { userId: String(userId) } })
    if (!broker) return reply.send({ connected: false })
    return reply.send({ connected: true, paper: broker.paper, status: broker.status, lastVerifiedAt: broker.lastVerifiedAt })
  })
}
