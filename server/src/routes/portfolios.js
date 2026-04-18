import portfoliosService from '../services/portfoliosService.js'

export default async function portfoliosRoutes(app, opts) {
  // GET /api/portfolios
  app.get('/', async (request, reply) => {
    const result = await portfoliosService.getPortfolios(request.query)
    return reply.send(result)
  })

  // GET /api/portfolios/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params
    const portfolio = await portfoliosService.getPortfolio(id)
    if (!portfolio) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Portfolio not found' } })
    }
    return { data: portfolio }
  })

  // POST /api/portfolios
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          userId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const portfolio = await portfoliosService.createPortfolio(request.body)
    return reply.code(201).send({ data: portfolio })
  })

  // PUT /api/portfolios/:id
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

  // DELETE /api/portfolios/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params
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
