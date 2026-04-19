import { useState, useEffect, useCallback } from 'react'
import backendEngineService from '../api/services/backendEngineService.js'

export function useAlphaEngineHealth() {
  const [health, setHealth] = useState({ status: 'unknown' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const checkHealth = useCallback(async () => {
    try {
      const result = await backendEngineService.checkHealth()
      setHealth(result)
      setError(null)
    } catch (err) {
      setError(err.message)
      setHealth({ status: 'error', error: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 30000) // Check every 30 seconds
    return () => clearInterval(interval)
  }, [checkHealth])

  return { health, loading, error, refetch: checkHealth }
}

export function useAlphaRankings(options = {}) {
  const { limit = 20, refreshInterval = 60000 } = options
  const [rankings, setRankings] = useState({ rankings: [], total: 0 })
  const [movers, setMovers] = useState({ rankings: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchRankings = useCallback(async () => {
    try {
      setLoading(true)
      const [topData, moversData] = await Promise.all([
        backendEngineService.getTopRankings(limit),
        backendEngineService.getRankingMovers(limit)
      ])
      
      setRankings(topData)
      setMovers(moversData)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Failed to fetch rankings:', err)
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    fetchRankings()
    if (refreshInterval > 0) {
      const interval = setInterval(fetchRankings, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [fetchRankings, refreshInterval])

  return { rankings, movers, loading, error, refetch: fetchRankings }
}

export function useAlphaSignals(options = {}) {
  const { refreshInterval = 30000 } = options
  const [signals, setSignals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchSignals = useCallback(async () => {
    try {
      setLoading(true)
      const activeSignals = await backendEngineService.getActiveSignals()
      setSignals(activeSignals)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Failed to fetch signals:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSignals()
    if (refreshInterval > 0) {
      const interval = setInterval(fetchSignals, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [fetchSignals, refreshInterval])

  return { signals, loading, error, refetch: fetchSignals }
}

export function useAlphaTicker(symbol) {
  const [explainability, setExplainability] = useState(null)
  const [performance, setPerformance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchTickerData = useCallback(async () => {
    if (!symbol) return

    try {
      setLoading(true)
      const [expData, perfData] = await Promise.all([
        backendEngineService.getTickerExplainability(symbol),
        backendEngineService.getTickerPerformance(symbol)
      ])
      
      setExplainability(expData)
      setPerformance(perfData)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error(`Failed to fetch data for ${symbol}:`, err)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    fetchTickerData()
  }, [fetchTickerData])

  return { explainability, performance, loading, error, refetch: fetchTickerData }
}

export function useAlphaDashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const data = await backendEngineService.getDashboardData()
      setDashboard(data)
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Failed to fetch dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [fetchDashboard])

  return { dashboard, loading, error, refetch: fetchDashboard }
}
