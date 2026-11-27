import prisma from '../loaders/prisma.js'
import portfoliosService from '../services/portfoliosService.js'
import { authenticate } from '../middleware/authenticate.js'
import { simulationConfig } from '../services/simulationService.js'
import {
  ensureDefaultPaperPortfolio,
  ensureExternalBrokeragePortfolio
} from '../services/defaultPaperPortfolioService.js'

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

  // POST /api/portfolios — creates portfolio for authenticated user
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user?.id
    if (!userId) {
      return reply.code(401).send({ error: 'User authentication required' })
    }

    const portfolio = await portfoliosService.createPortfolio({
      name: request.body.name,
      userId
    })
    return reply.code(201).send({ data: portfolio })
  })

  // PUT /api/portfolios/:id — verifies ownership before updating
  app.put('/:id', {
    schema: {
      body: {
        type: 'object',
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
