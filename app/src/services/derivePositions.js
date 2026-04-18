import executionsService from '../api/services/executionsService.js'
import { SETTLED_STATUSES } from '../api/constants.js'
import { derivePositionsEfficient } from './memoryEfficientData.js'

// SINGLE SOURCE OF TRUTH:
// positions must ONLY be derived from executions
// never store or mutate positions elsewhere

// Only queued/processing executions are not real positions yet —
// only settled executions (filled, partially_filled) count toward cost basis.
export function derivePositions(executions) {
  const settled = executions.filter(e => SETTLED_STATUSES.has(e.status))
  return derivePositionsEfficient(settled)
}

export async function getPositions(portfolioId = null) {
  try {
    let executions
    if (portfolioId) {
      executions = await executionsService.getByPortfolio(portfolioId)
    } else {
      executions = await executionsService.getAll()
    }

    return derivePositions(executions)
  } catch {
    return []
  }
}
