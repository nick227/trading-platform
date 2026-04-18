import strategiesRoutes from '../routes/strategies.js'
import predictionsRoutes from '../routes/predictions.js'
import botRoutes from '../routes/bots/index.js'
import executionRoutes from '../routes/executions.js'
import portfolioRoutes from '../routes/portfolios.js'

export default async function registerRoutes(app) {
  await app.register(strategiesRoutes, { prefix: '/api/strategies' })
  await app.register(predictionsRoutes, { prefix: '/api/predictions' })
  await app.register(botRoutes, { prefix: '/api/bots' })
  await app.register(executionRoutes, { prefix: '/api/executions' })
  await app.register(portfolioRoutes, { prefix: '/api/portfolios' })
}
