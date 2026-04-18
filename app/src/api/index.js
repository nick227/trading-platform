import { createAPI } from './config'
import routes from './routes'

const api = createAPI()

// Initialize services with API instance
const services = {
  strategies: routes.strategies(api),
  signals: routes.signals(api),
  trades: routes.trades(api),
  portfolios: routes.portfolios(api)
}

// Export individual services
export const strategies = services.strategies
export const signals = services.signals
export const trades = services.trades
export const portfolios = services.portfolios

// Export combined API object
export default {
  strategies,
  signals,
  trades,
  portfolios,
  config: api.config
}
