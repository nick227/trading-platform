import { authenticate } from '../middleware/authenticate.js'
import { fetchAlpacaMarketClock, getUserAlpacaCredentialsOrThrow } from '../services/alpacaClockService.js'

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
    return await getUserAlpacaCredentialsOrThrow(userId)
  } catch (err) {
    if (err?.code === 'LIVE_TRADING_DISABLED') {
      reply.code(403).send({ error: err.message })
      return null
    }
    if (err?.code === 'BROKER_NOT_CONFIGURED' || err?.code === 'BROKER_CREDENTIALS_INVALID') {
      reply.code(403).send({ error: err.message })
      return null
    }
    throw err
  }
}

export default async function alpacaRoutes(fastify) {
  // All Alpaca routes require authentication
  const preHandler = [authenticate]

  // POST /api/alpaca/order — RETIRED (P0 Execution Containment)
  // Direct unaudited broker order submission is permanently disabled.
  // All trade intents must flow through the audited Execution pipeline.
  fastify.post('/order', { preHandler }, async (_request, reply) => {
    return reply.code(410).send({
      error: 'Direct broker order submission is retired. Submit trade intents through /api/executions or /api/trade.',
      code: 'DIRECT_BROKER_EXECUTION_RETIRED'
    })
  })

  // GET /api/alpaca/order/:id (read-only inspection)
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

  // DELETE /api/alpaca/order/:id — RETIRED (P0 Execution Containment)
  // Direct unaudited broker cancellation is permanently disabled.
  fastify.delete('/order/:id', { preHandler }, async (_request, reply) => {
    return reply.code(410).send({
      error: 'Direct broker order cancellation is retired. Cancel orders through /api/executions/:id/cancel or /api/trade/:id.',
      code: 'DIRECT_BROKER_EXECUTION_RETIRED'
    })
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

