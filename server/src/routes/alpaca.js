import { authenticate } from '../middleware/authenticate.js'
import { fetchAlpacaMarketClock, resolveAlpacaCredentials } from '../services/alpacaClockService.js'

async function alpacaFetch(baseUrl, path, apiKey, apiSecret, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      ...options.headers
    },
    method: options.method || 'GET',
    body: options.body
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Alpaca ${res.status}: ${text}`)
  }
  return res.json()
}

async function resolveCredsOrReply(userId, reply) {
  try {
    const creds = await resolveAlpacaCredentials(userId)
    if (!creds) {
      reply.code(503).send({ error: 'Alpaca credentials not configured' })
      return null
    }
    return creds
  } catch (err) {
    if (err?.code === 'LIVE_TRADING_DISABLED') {
      reply.code(403).send({ error: err.message })
      return null
    }
    throw err
  }
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
          symbol: { type: 'string' },
          side: { type: 'string', enum: ['buy', 'sell'] },
          quantity: { type: 'number', minimum: 1 },
          type: { type: 'string', enum: ['market', 'limit'] },
          price: { type: 'number' },
          time_in_force: { type: 'string', enum: ['day', 'gtc', 'ioc', 'fok'] }
        }
      }
    }
  }, async (request, reply) => {
    const creds = await resolveCredsOrReply(request.user.id, reply)
    if (!creds) return

    try {
      const clock = await fetchAlpacaMarketClock(creds)
      if (!clock.isOpen) {
        return reply.code(409).send({
          error: 'Market is closed',
          code: 'MARKET_CLOSED',
          clock
        })
      }

      const order = await alpacaFetch(creds.baseUrl, '/v2/orders', creds.apiKey, creds.apiSecret, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request.body, symbol: request.body.symbol.toUpperCase() })
      })
      return reply.send(order)
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/alpaca/order/:id
  fastify.get('/order/:id', { preHandler }, async (request, reply) => {
    const creds = await resolveCredsOrReply(request.user.id, reply)
    if (!creds) return

    try {
      const order = await alpacaFetch(creds.baseUrl, `/v2/orders/${request.params.id}`, creds.apiKey, creds.apiSecret)
      return reply.send(order)
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // DELETE /api/alpaca/order/:id
  fastify.delete('/order/:id', { preHandler }, async (request, reply) => {
    const creds = await resolveCredsOrReply(request.user.id, reply)
    if (!creds) return

    try {
      await alpacaFetch(creds.baseUrl, `/v2/orders/${request.params.id}`, creds.apiKey, creds.apiSecret, { method: 'DELETE' })
      return reply.send({ success: true, message: 'Order cancelled' })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/alpaca/account
  fastify.get('/account', { preHandler }, async (request, reply) => {
    const creds = await resolveCredsOrReply(request.user.id, reply)
    if (!creds) return

    try {
      const data = await alpacaFetch(creds.baseUrl, '/v2/account', creds.apiKey, creds.apiSecret)
      return {
        equity: parseFloat(data.equity),
        cash: parseFloat(data.cash),
        buyingPower: parseFloat(data.buying_power),
        dayTradeCount: parseInt(data.daytrade_count ?? 0),
        patternDayTrader: data.pattern_day_trader ?? false,
        accountNumber: data.account_number ?? null
      }
    } catch (err) {
      fastify.log.error('Alpaca account fetch failed:', err.message)
      return reply.code(502).send({ error: err.message })
    }
  })

  // GET /api/alpaca/market-clock
  fastify.get('/market-clock', { preHandler }, async (request, reply) => {
    const creds = await resolveCredsOrReply(request.user.id, reply)
    if (!creds) return

    try {
      const clock = await fetchAlpacaMarketClock(creds)
      return clock
    } catch (err) {
      fastify.log.error('Alpaca clock fetch failed:', err.message)
      return reply.code(502).send({ error: err.message })
    }
  })
}

