// Standardized query parameter contracts for all services

export const QUERY_PARAMS = {
  // Resource filtering
  STRATEGY_ID: 'strategyId',
  TICKER: 'ticker',
  PORTFOLIO_ID: 'portfolioId',
  OPPORTUNITY_ID: 'opportunityId',
  SIDE: 'side',
  STATUS: 'status',
  
  // Date filtering
  CREATED_AT: 'createdAt',
  DATE_FROM: 'dateFrom',
  DATE_TO: 'dateTo',
  
  // Pagination
  LIMIT: 'limit',
  OFFSET: 'offset',
  PAGE: 'page'
}

// Query validation helpers
export function validateQueryParams(params, allowedParams) {
  const invalidParams = Object.keys(params).filter(key => !allowedParams.includes(key))
  if (invalidParams.length > 0) {
    throw new Error(`Invalid query parameters: ${invalidParams.join(', ')}`)
  }
  return true
}

// Standard query parameter sets for each resource
export const OPPORTUNITY_QUERY_PARAMS = [
  QUERY_PARAMS.STRATEGY_ID,
  QUERY_PARAMS.TICKER,
  QUERY_PARAMS.SIDE,
  QUERY_PARAMS.CREATED_AT,
  QUERY_PARAMS.DATE_FROM,
  QUERY_PARAMS.DATE_TO,
  QUERY_PARAMS.LIMIT,
  QUERY_PARAMS.OFFSET
]

export const EXECUTION_QUERY_PARAMS = [
  QUERY_PARAMS.PORTFOLIO_ID,
  QUERY_PARAMS.STRATEGY_ID,
  QUERY_PARAMS.TICKER,
  QUERY_PARAMS.SIDE,
  QUERY_PARAMS.STATUS,
  QUERY_PARAMS.CREATED_AT,
  QUERY_PARAMS.DATE_FROM,
  QUERY_PARAMS.DATE_TO,
  QUERY_PARAMS.LIMIT,
  QUERY_PARAMS.OFFSET
]

export const PORTFOLIO_QUERY_PARAMS = [
  QUERY_PARAMS.CREATED_AT,
  QUERY_PARAMS.DATE_FROM,
  QUERY_PARAMS.DATE_TO,
  QUERY_PARAMS.LIMIT,
  QUERY_PARAMS.OFFSET
]
