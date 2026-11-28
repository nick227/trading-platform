import prisma from '../loaders/prisma.js'
import portfoliosService from '../services/portfoliosService.js'
import { authenticate } from '../middleware/authenticate.js'
import { simulationConfig } from '../services/simulationService.js'
import {
  ensureDefaultPaperPortfolio,
  ensureExternalBrokeragePortfolio
} from '../services/defaultPaperPortfolioService.js'
import {
  AccountDomainError,
  createIndependentPortfolio,
  PORTFOLIO_ENVIRONMENTS
} from '../services/accountDomainService.js'

export default async function portfoliosRoutes(app) {
  // Enforce authentication across all portfolio endpoints
  app.addHook('preHandler', authenticate)

  // GET /api/portfolios/default — returns or creates the authenticated user's default portfolio,
  // keeping simulated paper portfolios strictly separated from external brokerage portfolios.
  app.get('/default', async (request, reply) => {
    const userId = request.user?.id
    if (!userId) {
      return reply.code(401).send({ error: 'User authentication required' })
    }

    if (!simulationConfig().enabled) {
      const externalBroker = await prisma.brokerAccount.findUnique({
        where: { userId: String(userId) }
      })
      if (externalBroker) {
        const brokerPortfolio = await ensureExternalBrokeragePortfolio(userId, { prismaClient: prisma })
        return reply.send({ data: brokerPortfolio })
      }
    }

    const paperPortfolio = await ensureDefaultPaperPortfolio(userId, { prismaClient: prisma })
    return reply.send({ data: paperPortfolio })
  })

  // GET /api/portfolios — returns portfolios belonging strictly to the authenticated user.
  app.get('/', async (request, reply) => {
    const userId = request.user?.id
    if (!userId) {
      return reply.code(401).send({ error: 'User authentication required' })
    }

    const result = await portfoliosService.getPortfolios({
      ...request.query,
      userId
    })
    return reply.send(result)
  })

  // GET /api/portfolios/:id — verifies user ownership
  app.get('/:id', async (request, reply) => {
    const { id } = request.params
    const portfolio = await portfoliosService.getPortfolio(id)
    if (!portfolio || portfolio.userId !== request.user.id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Portfolio not found' } })
    }
    return { data: portfolio }
  })

  // GET /api/portfolios/connections — returns masked BrokerConnection records for the authenticated user
  app.get('/connections', async (request, reply) => {
    const userId = request.user?.id
    if (!userId) return reply.code(401).send({ error: 'User authentication required' })
    const rows = typeof prisma.brokerConnection?.findMany === 'function'
      ? await prisma.brokerConnection.findMany({
          where: { userId: String(userId) },
          orderBy: { createdAt: 'desc' }
        })
      : []
    return reply.send({
      data: rows.map(({ encryptedApiKey: _k, encryptedApiSecret: _s, ...safe }) => safe)
    })
  })

  // POST /api/portfolios — creates an independent portfolio for authenticated user
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          environment: { type: 'string', enum: ['internal_sim', 'alpaca_paper', 'alpaca_live'] },
          brokerConnectionId: { type: ['string', 'null'] },
          startingCash: { type: 'number', minimum: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user?.id
    if (!userId) {
      return reply.code(401).send({ error: 'User authentication required' })
    }

    try {
      const portfolio = await createIndependentPortfolio({
        userId,
        name: request.body.name,
        environment: request.body.environment ?? PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM,
        brokerConnectionId: request.body.brokerConnectionId ?? null,
        startingCash: request.body.startingCash,
        prismaClient: prisma
      })
      return reply.code(201).send({ data: portfolio })
    } catch (error) {
      if (error instanceof AccountDomainError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
      }
      throw error
    }
  })

  // PUT /api/portfolios/:id — verifies ownership and enforces immutable environment/broker identity
  app.put('/:id', {
    preValidation: async (request, reply) => {
      if (request.body && typeof request.body === 'object') {
        if ('environment' in request.body || 'brokerConnectionId' in request.body || 'accountKind' in request.body) {
          return reply.code(409).send({
            error: {
              code: 'PORTFOLIO_IDENTITY_IMMUTABLE',
              message: 'Portfolio environment and brokerage connection binding cannot be changed after creation.'
            }
          })
        }
      }
    },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const existing = await portfoliosService.getPortfolio(id)
    if (!existing || existing.userId !== request.user.id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Portfolio not found' } })
    }

    try {
      const portfolio = await portfoliosService.updatePortfolio(id, request.body)
      return { data: portfolio }
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Portfolio not found' } })
      }
      throw error
    }
  })

  // DELETE /api/portfolios/:id — verifies ownership before deleting
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params
    const existing = await portfoliosService.getPortfolio(id)
    if (!existing || existing.userId !== request.user.id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Portfolio not found' } })
    }

    try {
      await portfoliosService.deletePortfolio(id)
      return reply.code(204).send()
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Portfolio not found' } })
      }
      if (error.message.includes('Cannot delete portfolio')) {
        return reply.code(400).send({ error: { code: 'HAS_DEPENDENCIES', message: error.message } })
      }
      throw error
    }
  })
}
