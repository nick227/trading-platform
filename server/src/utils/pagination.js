export function buildOffsetPagination(query) {
  const { offset = 0, limit = 50 } = query
  const take = Math.min(parseInt(limit), 100)
  const skip = Math.max(parseInt(offset), 0)
  
  return { take, skip }
}

export function buildExecutionWhere(query) {
  const { portfolioId, strategyId, botId, ticker, direction, status, dateFrom, dateTo, after } = query
  const where = {}
  if (portfolioId) where.portfolioId = portfolioId
  if (strategyId) where.strategyId = strategyId
  if (botId) where.botId = botId
  if (ticker) where.ticker = ticker
  if (direction) where.direction = direction
  if (status) where.status = status
  
  // Handle date filters
  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) where.createdAt.gte = new Date(parseInt(dateFrom))
    if (dateTo) where.createdAt.lte = new Date(parseInt(dateTo))
  }
  
  // Apply cursor filter - use pipe delimiter to avoid underscore conflicts
  if (after) {
    const [cursorDate, cursorId] = after.split('|')
    
    // Preserve existing date filters if any
    const existingDateFilter = where.createdAt || {}
    
    where.OR = [
      { createdAt: { lt: new Date(parseInt(cursorDate)) } },
      { 
        createdAt: new Date(parseInt(cursorDate)),
        id: { lt: cursorId }
      }
    ]
    
    // Apply date filters to both OR conditions
    if (Object.keys(existingDateFilter).length > 0) {
      where.OR = where.OR.map(condition => ({
        ...condition,
        createdAt: {
          ...existingDateFilter,
          ...condition.createdAt
        }
      }))
    }
  }
  
  return where
}
