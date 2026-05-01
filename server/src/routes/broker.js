import brokerService from '../services/brokerService.js'
import { authenticate } from '../middleware/authenticate.js'

export default async function brokerRoutes(app) {
  app.addHook('preHandler', authenticate)

  // POST /api/broker — create or replace broker account credentials
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['apiKey', 'apiSecret'],
        properties: {
          apiKey:    { type: 'string', minLength: 1 },
          apiSecret: { type: 'string', minLength: 1 },
          paper:     { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { apiKey, apiSecret, paper = true } = request.body
    const base = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'

    try {
      const verifyRes = await fetch(`${base}/v2/account`, {
        headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret }
      })
      if (!verifyRes.ok) {
        return reply.code(400).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid Alpaca credentials — verification failed' } })
      }
    } catch {
      return reply.code(502).send({ error: { code: 'BROKER_UNREACHABLE', message: 'Could not reach Alpaca to verify credentials' } })
    }

    const account = await brokerService.createBrokerAccount({
      userId: request.user.id,
      apiKey,
      apiSecret,
      paper
    })
    // Never echo the secret back — return masked version
    return reply.code(201).send({ data: maskSecret(account) })
  })

  // GET /api/broker — fetch current user account info (masked)
  app.get('/', async (request, reply) => {
    const account = await brokerService.getBrokerAccount(request.user.id)
    if (!account) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No broker account configured' } })
    }
    return reply.send({ data: account })
  })

  // DELETE /api/broker — remove current user broker account
  app.delete('/', async (request, reply) => {
    const result = await brokerService.deleteBrokerAccount(request.user.id)
    if (!result) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No broker account configured' } })
    }
    return reply.code(200).send({ data: result })
  })
}

function maskSecret(account) {
  return {
    ...account,
    apiKey:    '••••••••••••',
    apiSecret: '••••••••••••••••'
  }
}
