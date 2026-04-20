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

export default async function registerRoutes(app) {
  await app.register(authRoutes,        { prefix: '/api/auth' })
  await app.register(strategiesRoutes,  { prefix: '/api/strategies' })
  await app.register(predictionsRoutes, { prefix: '/api/predictions' })
  // /api/bots disabled until schema/service alignment is complete.
  // The worker bot engine is the source of truth; this HTTP surface is currently unsafe to expose.
  await app.register(operatorBotRoutes, { prefix: '/api/bot' })
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
}
