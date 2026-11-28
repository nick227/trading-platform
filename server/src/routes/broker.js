import brokerService from '../services/brokerService.js'
import { authenticate } from '../middleware/authenticate.js'
import {
  AccountDomainError,
  connectOrRotateBrokerAccount,
  disconnectUserBrokerConnections
} from '../services/accountDomainService.js'

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
    if (!paper && process.env.ALLOW_LIVE_TRADING !== 'true') {
      return reply.code(403).send({
        error: {
          code: 'LIVE_TRADING_DISABLED',
          message: 'Live brokerage execution is disabled. Only Alpaca paper credentials may be connected.'
        }
      })
    }
    const base = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'

    let verifiedAccount = null
    try {
      const verifyRes = await fetch(`${base}/v2/account`, {
        headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret }
      })
      if (!verifyRes.ok) {
        return reply.code(400).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid Alpaca credentials — verification failed' } })
      }
      verifiedAccount = await verifyRes.json().catch(() => null)
    } catch {
      return reply.code(502).send({ error: { code: 'BROKER_UNREACHABLE', message: 'Could not reach Alpaca to verify credentials' } })
    }

    try {
      const { legacyAccount, connection } = await connectOrRotateBrokerAccount({
        userId: request.user.id,
        apiKey,
        apiSecret,
        paper,
        verifiedAccount
      })
      const account = legacyAccount ?? await brokerService.createBrokerAccount({
        userId: request.user.id,
        apiKey,
        apiSecret,
        paper
      })
      return reply.code(201).send({
        data: {
          ...maskSecret(account),
          ...(connection ? { brokerConnectionId: connection.id, externalAccountId: connection.externalAccountId } : {})
        }
      })
    } catch (err) {
      if (err instanceof AccountDomainError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // GET /api/broker — fetch current user account info (masked)
  app.get('/', async (request, reply) => {
    const account = await brokerService.getBrokerAccount(request.user.id)
    if (!account) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No broker account configured' } })
    }
    return reply.send({ data: account })
  })

  // DELETE /api/broker — remove current user broker account & halt bound brokerage portfolios without redirecting bots
  app.delete('/', async (request, reply) => {
    const result = await disconnectUserBrokerConnections(request.user.id)
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
