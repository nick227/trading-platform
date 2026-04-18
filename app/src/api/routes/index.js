import strategiesService from '../services/strategiesService'
import signalsService from '../services/signalsService'
import tradesService from '../services/tradesService'
import portfoliosService from '../services/portfoliosService'

const routes = {
  strategies: strategiesService,
  signals: signalsService,
  trades: tradesService,
  portfolios: portfoliosService
}

export default routes
