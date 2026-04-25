import { useCallback, useMemo, useState } from 'react'
import executionsService from '../api/services/executionsService.js'
import { STATUS } from '../api/constants.js'
import { useConditionalPolling } from './usePolling.js'

const PENDING_STATUSES = new Set([STATUS.QUEUED, STATUS.PROCESSING])

export function usePendingOrders({ enabled = true, pollIntervalMs = 5000, executions: externalExecutions } = {}) {
  const [internalExecutions, setInternalExecutions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [cancelingIds, setCancelingIds] = useState(() => new Set())

  // Use external executions if provided, otherwise use internal state
  const executions = externalExecutions ?? internalExecutions

  const pendingOrders = useMemo(() => {
    return executions.filter(e => PENDING_STATUSES.has(e.status))
  }, [executions])

  const refetch = useCallback(async () => {
    if (!enabled || externalExecutions) return // Skip fetch if using external executions
    setLoading(true)
    setError(null)
    try {
      const data = await executionsService.getAll()
      setInternalExecutions(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message ?? 'Failed to load pending orders')
      setInternalExecutions([])
    } finally {
      setLoading(false)
    }
  }, [enabled, externalExecutions])

  const cancelOrder = useCallback(async (id) => {
    if (!id) return null
    setCancelingIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })

    // Optimistically remove from local list
    if (!externalExecutions) {
      setInternalExecutions(prev => prev.filter(e => e.id !== id))
    }
    try {
      const updated = await executionsService.cancel(id)
      return updated
    } finally {
      setCancelingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      // Ensure we converge to server truth (e.g. if cancel fails)
      refetch()
    }
  }, [refetch, externalExecutions])

  useConditionalPolling(refetch, pollIntervalMs, enabled && !externalExecutions)

  const isCanceling = useCallback((id) => cancelingIds.has(id), [cancelingIds])

  return { pendingOrders, executions, loading, error, refetch, cancelOrder, isCanceling }
}
