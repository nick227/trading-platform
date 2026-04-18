import strategiesService from '../services/strategiesService.js'

export default async function strategiesRoutes(app, opts) {
  // GET /api/strategies
  app.get('/', async (request, reply) => {
    const result = await strategiesService.getStrategies(request.query)
    return reply.send(result)
  })

  // GET /api/strategies/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params
    const strategy = await strategiesService.getStrategy(id)
    if (!strategy) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Strategy not found' } })
    }
    return { data: strategy }
  })

  // POST /api/strategies
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          type: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const strategy = await strategiesService.createStrategy(request.body)
    return reply.code(201).send({ data: strategy })
  })

  // PUT /api/strategies/:id
  app.put('/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          type: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    try {
      const strategy = await strategiesService.updateStrategy(id, request.body)
      return { data: strategy }
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Strategy not found' } })
      }
      throw error
    }
  })

  // DELETE /api/strategies/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params
    try {
      await strategiesService.deleteStrategy(id)
      return reply.code(204).send()
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Strategy not found' } })
      }
      if (error.message.includes('Cannot delete strategy')) {
        return reply.code(400).send({ error: { code: 'HAS_DEPENDENCIES', message: error.message } })
      }
      throw error
    }
  })
}
