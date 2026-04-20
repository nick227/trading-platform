import prisma from '../loaders/prisma.js'
import { authenticate } from '../middleware/authenticate.js'
import { decrypt } from '../utils/encryption.js'

const ALPACA_BASE = 'https://paper-api.alpaca.markets'

async function alpacaFetch(path, apiKey, apiSecret, options = {}) {
  const res = await fetch(`${ALPACA_BASE}${path}`, {
    headers: {
      'APCA-API-KEY-ID':     apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      ...options.headers
    },
    method: options.method || 'GET',
    body:   options.body
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Alpaca ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Resolves Alpaca credentials for a request.
 * Priority: per-user BrokerAccount (decrypted) → process.env fallback.
 * Returns { apiKey, apiSecret } or null if neither is available.
 */
async function resolveCredentials(userId) {
  if (userId) {
    const broker = await prisma.brokerAccount.findUnique({ where: { userId } })
    if (broker?.apiKey && broker?.apiSecret) {
      try {
        return { apiKey: decrypt(broker.apiKey), apiSecret: decrypt(broker.apiSecret) }
      } catch {
        // Decryption failed (key mismatch) — fall through to env
      }
    }
  }
  const apiKey    = process.env.ALPACA_API_KEY
  const apiSecret = process.env.ALPACA_API_SECRET
  if (apiKey && apiSecret) return { apiKey, apiSecret }
  return null
}

export default async function alpacaRoutes(fastify) {
  // All Alpaca routes require authentication
  const preHandler = [authenticate]

  // POST /api/alpaca/order
  fastify.post('/order', {
    preHandler,
    schema: {
      body: {
        type: 'object',
        required: ['symbol', 'side', 'quantity', 'type'],
        properties: {
          symbol:        { type: 'string' },
          side:          { type: 'string', enum: ['buy', 'sell'] },
          quantity:      { type: 'number', minimum: 1 },
          type:          { type: 'string', enum: ['market', 'limit'] },
          price:         { type: 'number' },
          time_in_force: { type: 'string', enum: ['day', 'gtc', 'ioc', 'fok'] }
        }
      }
    }
  }, async (request, reply) => {
    const creds = await resolveCredentials(request.user.id)
    if (!creds) return reply.code(503).send({ error: 'Alpaca credentials not configured' })

    try {
      const order = await alpacaFetch('/v2/orders', creds.apiKey, creds.apiSecret, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...request.body, symbol: request.body.symbol.toUpperCase() })
      })
      return reply.send(order)
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/alpaca/order/:id
  fastify.get('/order/:id', { preHandler }, async (request, reply) => {
    const creds = await resolveCredentials(request.user.id)
    if (!creds) return reply.code(503).send({ error: 'Alpaca credentials not configured' })

    try {
      const order = await alpacaFetch(`/v2/orders/${request.params.id}`, creds.apiKey, creds.apiSecret)
      return reply.send(order)
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // DELETE /api/alpaca/order/:id
  fastify.delete('/order/:id', { preHandler }, async (request, reply) => {
    const creds = await resolveCredentials(request.user.id)
    if (!creds) return reply.code(503).send({ error: 'Alpaca credentials not configured' })

    try {
      await alpacaFetch(`/v2/orders/${request.params.id}`, creds.apiKey, creds.apiSecret, { method: 'DELETE' })
      return reply.send({ success: true, message: 'Order cancelled' })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/alpaca/account
  fastify.get('/account', { preHandler }, async (request, reply) => {
    const creds = await resolveCredentials(request.user.id)
    if (!creds) return reply.code(503).send({ error: 'Alpaca credentials not configured' })

    try {
      const data = await alpacaFetch('/v2/account', creds.apiKey, creds.apiSecret)
      return {
        equity:           parseFloat(data.equity),
        cash:             parseFloat(data.cash),
        buyingPower:      parseFloat(data.buying_power),
        dayTradeCount:    parseInt(data.daytrade_count ?? 0),
        patternDayTrader: data.pattern_day_trader ?? false,
        accountNumber:    data.account_number ?? null
      }
    } catch (err) {
      fastify.log.error('Alpaca account fetch failed:', err.message)
      return reply.code(502).send({ error: err.message })
    }
  })

  // GET /api/alpaca/market-clock
  fastify.get('/market-clock', { preHandler }, async (request, reply) => {
    const creds = await resolveCredentials(request.user.id)
    if (!creds) return reply.code(503).send({ error: 'Alpaca credentials not configured' })

    try {
      const data = await alpacaFetch('/v2/clock', creds.apiKey, creds.apiSecret)
      return {
        isOpen:    data.is_open,
        nextOpen:  data.next_open,
        nextClose: data.next_close,
        timestamp: data.timestamp
      }
    } catch (err) {
      fastify.log.error('Alpaca clock fetch failed:', err.message)
      return reply.code(502).send({ error: err.message })
    }
  })
}
