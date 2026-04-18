// Locked endpoint names for API consistency

export const ENDPOINTS = {
  // Strategies
  GET_STRATEGIES: '/api/strategies',
  GET_STRATEGY: '/api/strategies/:id',
  
  // Predictions (was Signals)
  GET_SIGNALS: '/api/predictions',
  GET_SIGNAL: '/api/predictions/:id',
  GET_SIGNALS_BY_STRATEGY: '/api/predictions',
  GET_SIGNALS_BY_TICKER: '/api/predictions',
  GET_SIGNALS_BY_LAYER: '/api/predictions',
  
  // Executions (was Trades)
  GET_TRADES: '/api/executions',
  GET_TRADE: '/api/executions/:id',
  GET_TRADES_BY_TICKER: '/api/executions',
  GET_TRADES_BY_STRATEGY: '/api/executions',
  GET_TRADES_BY_PORTFOLIO: '/api/executions',
  CREATE_TRADE: '/api/executions',
  
  // Portfolios
  GET_PORTFOLIOS: '/api/portfolios',
  GET_PORTFOLIO: '/api/portfolios/:id',
  CREATE_PORTFOLIO: '/api/portfolios',
  GET_PORTFOLIO_HOLDINGS: '/api/portfolios/:id/holdings',
  GET_PORTFOLIO_SUMMARY: '/api/portfolios/:id/summary'
}

// Query parameter mappings
export const QUERY_PARAMS = {
  STRATEGY_LAYER: 'layer',
  TICKER: 'ticker',
  STRATEGY_ID: 'strategyId',
  PORTFOLIO_ID: 'portfolioId'
}
