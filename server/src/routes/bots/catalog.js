import botsService from '../../services/botsService.js'

export default async function catalogRoutes(app, opts) {
  // GET /api/bots/catalog
  // Returns all bot templates grouped by type. Optional ?botType=rule_based|strategy_based filter.
  app.get('/', async (request, reply) => {
    const templates = await botsService.getCatalog(request.query)
    
    // Group templates by botType as expected by frontend
    const grouped = {
      ruleBased: templates.filter(t => t.botType === 'rule_based'),
      strategyBased: templates.filter(t => t.botType === 'strategy_based')
    }
    
    return { data: grouped }
  })

  // GET /api/bots/catalog/:id
  app.get('/:id', async (request, reply) => {
    const template = await botsService.getCatalogTemplate(request.params.id)
    if (!template) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } })
    }
    return { data: template }
  })

}
