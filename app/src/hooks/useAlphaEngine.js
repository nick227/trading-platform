import { useState, useEffect, useCallback } from 'react'
import alphaEngineService from '../api/services/alphaEngineService.js'

export function useAlphaEngineHealth() {
  const [health, setHealth] = useState({ status: 'unknown' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const checkHealth = useCallback(async () => {
    try {
      const result = await alphaEngineService.checkHealth()
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
        alphaEngineService.getTopRankings(limit),
        alphaEngineService.getRankingMovers(limit)
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
      const activeSignals = await alphaEngineService.getActiveSignals()
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

export function useCalendarEvents(month, limit = 50, distribution = 'uniform', minDays = 12) {
  const [events, setEvents] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchCalendarEvents = useCallback(async () => {
    try {
      setLoading(true)
      const data = await alphaEngineService.getCalendarEvents(month, limit, distribution, minDays)
      setEvents(data.events || [])
      setSummary({
        eventCount: data.eventCount || 0,
        minimumExpected: data.minimumExpected || 10,
        meetsMinimum: data.meetsMinimum || false,
        countsByType: data.countsByType || {},
        distinctDays: data.distinctDays || 0,
        minimumDaysTarget: data.minimumDaysTarget || minDays,
        meetsDayTarget: data.meetsDayTarget || false,
        distribution: data.distribution || distribution
      })
      setError(null)
    } catch (err) {
      setError(err.message)
      console.error('Failed to fetch calendar events:', err)
      setEvents([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [month, limit, distribution, minDays])

  useEffect(() => {
    fetchCalendarEvents()
  }, [fetchCalendarEvents])

  return { events, summary, loading, error, refetch: fetchCalendarEvents }
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
        alphaEngineService.getTickerExplainability(symbol),
        alphaEngineService.getTickerPerformance(symbol)
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

export function useAlphaDashboard(options = {}) {
  const { refreshInterval = 60000 } = options
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const data = await alphaEngineService.getDashboardData()
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
    if (refreshInterval > 0) {
      const interval = setInterval(fetchDashboard, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [fetchDashboard, refreshInterval])

  return { dashboard, loading, error, refetch: fetchDashboard }
}
