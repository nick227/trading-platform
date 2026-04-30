import { useState, useEffect, useCallback } from 'react'
import { get } from '../api/client.js'

// Shared state to prevent multiple polling intervals
let sharedData = null
let listenerCount = 0
let pollingIntervalId = null

export function useDashboardBootstrap(options = {}) {
  const { refreshInterval = 60000 } = options
  const [data, setData] = useState(() => sharedData)
  const [loading, setLoading] = useState(() => listenerCount === 0)
  const [error, setError] = useState(null)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const response = await get('/engine/dashboard/bootstrap')
      sharedData = response
      setData(response)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Failed to fetch dashboard bootstrap data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    listenerCount++
    if (listenerCount === 1 && !pollingIntervalId && refreshInterval > 0) {
      fetchDashboard()
      pollingIntervalId = setInterval(fetchDashboard, refreshInterval)
    }

    return () => {
      listenerCount--
      if (listenerCount === 0 && pollingIntervalId) {
        clearInterval(pollingIntervalId)
        pollingIntervalId = null
      }
    }
  }, [fetchDashboard, refreshInterval])

  return {
    data,
    loading,
    error,
    refetch: fetchDashboard,
    // Convenience accessors
    engine: data?.engine,
    bots: data?.bots,
    executions: data?.executions,
    prices: data?.prices,
    performanceStats: data?.performanceStats,
    portfolioSummary: data?.portfolioSummary
  }
}
