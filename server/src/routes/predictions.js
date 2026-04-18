import predictionsService from '../services/predictionsService.js'

export default async function predictionsRoutes(app, opts) {
  app.get('/', async (request, reply) => {
    const result = await predictionsService.getPredictions(request.query)
    return reply.send(result)
  })

  app.get('/:id', async (request, reply) => {
    const item = await predictionsService.getPredictionById(request.params.id)
    if (!item) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Prediction not found' } })
    }
    return { data: item }
  })
}
