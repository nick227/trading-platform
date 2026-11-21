import authRoutes from '../routes/auth.js'
import strategiesRoutes from '../routes/strategies.js'
import predictionsRoutes from '../routes/predictions.js'
import operatorBotRoutes from '../routes/bot.js'
import executionRoutes from '../routes/executions.js'
import portfolioRoutes from '../routes/portfolios.js'
import brokerRoutes from '../routes/broker.js'
import opsRoutes from '../routes/ops.js'
import engineRoutes from '../routes/engine.js'
import alpacaRoutes from '../routes/alpaca.js'
import performanceRoutes from '../routes/performance.js'
import accountRoutes from '../routes/account.js'
import tradeRoutes from '../routes/trade.js'
import marketRoutes from '../routes/market.js'
import ordersRoutes from '../routes/orders.js'
import botRoutes from '../routes/bots/index.js'
import riskRoutes from '../routes/risk.js'
import metricsRoutes from '../routes/metrics.js'
import { authenticate } from '../middleware/authenticate.js'
import { engineClient } from '../clients/engine.js'

export default async function registerRoutes(app) {
  await app.register(authRoutes,        { prefix: '/api/auth' })
  await app.register(strategiesRoutes,  { prefix: '/api/strategies' })
  await app.register(predictionsRoutes, { prefix: '/api/predictions' })
  // /api/bots disabled until schema/service alignment is complete.
  // The worker bot engine is the source of truth; this HTTP surface is currently unsafe to expose.
  await app.register(operatorBotRoutes, { prefix: '/api/bot' })

  // Bot CRUD (rule bots) — requires auth.
  // The worker is still the runtime engine; these routes manage configuration only.
  await app.register(async (secured) => {
    secured.addHook('preHandler', authenticate)
    await secured.register(botRoutes, { prefix: '/api/bots' })
  })
  await app.register(executionRoutes,   { prefix: '/api/executions' })
  await app.register(portfolioRoutes,   { prefix: '/api/portfolios' })
  await app.register(brokerRoutes,      { prefix: '/api/broker' })
  await app.register(opsRoutes,         { prefix: '/api/ops' })
  await app.register(engineRoutes,      { prefix: '/api/engine' })
  await app.register(alpacaRoutes,      { prefix: '/api/alpaca' })
  await app.register(performanceRoutes, { prefix: '/api/performance' })
  await app.register(accountRoutes,     { prefix: '/api/account' })
  await app.register(tradeRoutes,       { prefix: '/api/trade' })
  await app.register(marketRoutes,     { prefix: '/api/market' })
  await app.register(ordersRoutes,      { prefix: '/api/orders' })
  await app.register(riskRoutes,        { prefix: '/api/risk' })
  await app.register(metricsRoutes,     { prefix: '/api/metrics' })

  // Direct root regime mapping for UI components calling /api/regime/:symbol
  app.get('/api/regime/:symbol', async (request, reply) => {
    try {
      const data = await engineClient.getRegime(request.params.symbol)
      return reply.send({ success: true, data })
    } catch (error) {
      request.log?.warn?.({ err: error, symbol: request.params.symbol }, 'Failed to fetch regime from engine, returning degraded fallback')
      return reply.send({
        success: true,
        data: {
          symbol: request.params.symbol,
          marketRegime: 'UNKNOWN',
          confidence: 0,
          isDegraded: true,
          source: 'fallback'
        }
      })
    }
  })

  // Direct root tickers alias
  app.get('/tickers', async (request, reply) => {
    try {
      const data = await engineClient.getTickers()
      return reply.send({ success: true, data })
    } catch (error) {
      return reply.code(error.status ?? 500).send({ error: error.message })
    }
  })
}
