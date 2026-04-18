import brokerService from '../services/brokerService.js'

export default async function brokerRoutes(app) {
  // POST /api/broker — create or replace broker account credentials
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'apiKey', 'apiSecret'],
        properties: {
          userId:    { type: 'string' },
          apiKey:    { type: 'string', minLength: 1 },
          apiSecret: { type: 'string', minLength: 1 },
          paper:     { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const account = await brokerService.createBrokerAccount(request.body)
    // Never echo the secret back — return masked version
    return reply.code(201).send({ data: maskSecret(account) })
  })

  // GET /api/broker/:userId — fetch account info (masked)
  app.get('/:userId', async (request, reply) => {
    const account = await brokerService.getBrokerAccount(request.params.userId)
    if (!account) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No broker account for this user' } })
    }
    return reply.send({ data: account })
  })

  // DELETE /api/broker/:userId — remove broker account
  app.delete('/:userId', async (request, reply) => {
    const result = await brokerService.deleteBrokerAccount(request.params.userId)
    if (!result) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No broker account for this user' } })
    }
    return reply.code(200).send({ data: result })
  })
}

function maskSecret(account) {
  return {
    ...account,
    apiKey:    account.apiKey.slice(0, 4) + '••••••••••••',
    apiSecret: '••••••••••••••••'
  }
}
