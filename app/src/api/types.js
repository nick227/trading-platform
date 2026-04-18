// Shared types and schemas for API consistency

export const SIDE = {
  BUY: 'buy',
  SELL: 'sell'
}

export const OPPORTUNITY_STATUS = {
  ACTIVE: 'active',
  WATCH: 'watch',
  EXPIRED: 'expired'
}

export const TRADE_STATUS = {
  FILLED: 'filled',
  PROPOSED: 'proposed',
  CANCELLED: 'cancelled'
}

// Internal strategy layers - not exposed in public API
export const STRATEGY_LAYERS = {
  DISCOVERY: 'discovery',
  ENGINE: 'engine'
}

export const PORTFOLIO_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
}

// Base field schemas
export const BASE_FIELDS = {
  ID: 'id',
  TICKER: 'ticker',
  STRATEGY_ID: 'strategyId',
  PORTFOLIO_ID: 'portfolioId',
  OPPORTUNITY_ID: 'opportunityId',
  CREATED_AT: 'createdAt',
  STATUS: 'status',
  SIDE: 'side',
  QUANTITY: 'quantity',
  PRICE: 'price'
}

// Complete execution schema
export const EXECUTION_SCHEMA = {
  id: 'string',
  ticker: 'string',
  portfolioId: 'string',
  strategyId: 'string',
  opportunityId: 'string|null',
  side: Object.values(SIDE),
  quantity: 'number',
  price: 'number',
  status: Object.values(TRADE_STATUS),
  createdAt: 'number',
  commission: 'number',
  fees: 'number',
  total: 'number'
}

// Opportunity schema
export const OPPORTUNITY_SCHEMA = {
  id: 'string',
  strategyId: 'string',
  ticker: 'string',
  score: 'number',
  confidence: 'number',
  entryPrice: 'number',
  stopPrice: 'number',
  targetPrice: 'number',
  createdAt: 'number',
  side: Object.values(SIDE),
  status: Object.values(OPPORTUNITY_STATUS),
  reasoning: 'string'
}

// Strategy schema
export const STRATEGY_SCHEMA = {
  id: 'string',
  name: 'string',
  description: 'string',
  layer: Object.values(STRATEGY_LAYERS),
  type: 'string'
}

// Portfolio schema
export const PORTFOLIO_SCHEMA = {
  id: 'string',
  name: 'string',
  createdAt: 'number'
}

// Holding schema (computed)
export const HOLDING_SCHEMA = {
  ticker: 'string',
  quantity: 'number',
  totalCost: 'number',
  avgCost: 'number',
  currentPrice: 'number',
  marketValue: 'number',
  unrealizedPnL: 'number',
  unrealizedPnLPct: 'number'
}

// Validation helpers
export function validateExecution(execution) {
  const required = ['id', 'ticker', 'portfolioId', 'strategyId', 'side', 'quantity', 'price', 'status', 'createdAt']
  const missing = required.filter(field => !(field in execution))
  
  if (missing.length > 0) {
    throw new Error(`Missing required execution fields: ${missing.join(', ')}`)
  }
  
  if (!Object.values(SIDE).includes(execution.side)) {
    throw new Error(`Invalid execution side: ${execution.side}`)
  }
  
  if (!Object.values(TRADE_STATUS).includes(execution.status)) {
    throw new Error(`Invalid execution status: ${execution.status}`)
  }
  
  return true
}

export function validateOpportunity(opportunity) {
  const required = ['id', 'strategyId', 'ticker', 'score', 'confidence', 'createdAt', 'side', 'status']
  const missing = required.filter(field => !(field in opportunity))
  
  if (missing.length > 0) {
    throw new Error(`Missing required opportunity fields: ${missing.join(', ')}`)
  }
  
  if (opportunity.score < 0 || opportunity.score > 1) {
    throw new Error(`Opportunity score must be between 0 and 1: ${opportunity.score}`)
  }
  
  if (opportunity.confidence < 0 || opportunity.confidence > 1) {
    throw new Error(`Opportunity confidence must be between 0 and 1: ${opportunity.confidence}`)
  }
  
  return true
}
