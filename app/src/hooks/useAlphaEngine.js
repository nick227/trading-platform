import { useState, useEffect, useCallback } from 'react'
import alphaEngineService from '../api/services/alphaEngineService.js'

// Shared state to prevent multiple polling intervals
let sharedHealth = { status: 'unknown' }
let healthListenerCount = 0
let healthIntervalId = null

let sharedRankings = { rankings: [], total: 0 }
let sharedMovers = { rankings: [], total: 0 }
let rankingsListenerCount = 0
let rankingsIntervalId = null

let sharedSignals = []
let signalsListenerCount = 0
let signalsIntervalId = null

let sharedDashboard = null
let dashboardListenerCount = 0
let dashboardIntervalId = null

export function useAlphaEngineHealth() {
  const [health, setHealth] = useState(() => sharedHealth)
  const [loading, setLoading] = useState(() => healthListenerCount === 0)
  const [error, setError] = useState(null)

  const checkHealth = useCallback(async () => {
    try {
      const result = await alphaEngineService.checkHealth()
      sharedHealth = result
      setHealth(result)
      setError(null)
    } catch (err) {
      setError(err.message)
      sharedHealth = { status: 'error', error: err.message }
      setHealth(sharedHealth)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    healthListenerCount++
    if (healthListenerCount === 1 && !healthIntervalId) {
      checkHealth()
      healthIntervalId = setInterval(checkHealth, 30000)
    }

    return () => {
      healthListenerCount--
      if (healthListenerCount === 0 && healthIntervalId) {
        clearInterval(healthIntervalId)
        healthIntervalId = null
      }
    }
  }, [checkHealth])

  return { health, loading, error, refetch: checkHealth }
}

export function useAlphaRankings(options = {}) {
  const { limit = 20, refreshInterval = 60000 } = options
  const [rankings, setRankings] = useState(() => sharedRankings)
  const [movers, setMovers] = useState(() => sharedMovers)
  const [loading, setLoading] = useState(() => rankingsListenerCount === 0)
  const [error, setError] = useState(null)

  const fetchRankings = useCallback(async () => {
    try {
      setLoading(true)
      const [topData, moversData] = await Promise.all([
        alphaEngineService.getTopRankings(limit),
        alphaEngineService.getRankingMovers(limit)
      ])

      sharedRankings = topData
      sharedMovers = moversData
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
    rankingsListenerCount++
    if (rankingsListenerCount === 1 && !rankingsIntervalId && refreshInterval > 0) {
      fetchRankings()
      rankingsIntervalId = setInterval(fetchRankings, refreshInterval)
    }

    return () => {
      rankingsListenerCount--
      if (rankingsListenerCount === 0 && rankingsIntervalId) {
        clearInterval(rankingsIntervalId)
        rankingsIntervalId = null
      }
    }
  }, [fetchRankings, refreshInterval])

  return { rankings, movers, loading, error, refetch: fetchRankings }
}

export function useAlphaSignals(options = {}) {
  const { refreshInterval = 30000 } = options
  const [signals, setSignals] = useState(() => sharedSignals)
  const [loading, setLoading] = useState(() => signalsListenerCount === 0)
  const [error, setError] = useState(null)

  const fetchSignals = useCallback(async () => {
    try {
      setLoading(true)
      const activeSignals = await alphaEngineService.getActiveSignals()
      sharedSignals = activeSignals
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
    signalsListenerCount++
    if (signalsListenerCount === 1 && !signalsIntervalId && refreshInterval > 0) {
      fetchSignals()
      signalsIntervalId = setInterval(fetchSignals, refreshInterval)
    }

    return () => {
      signalsListenerCount--
      if (signalsListenerCount === 0 && signalsIntervalId) {
        clearInterval(signalsIntervalId)
        signalsIntervalId = null
      }
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
  const [dashboard, setDashboard] = useState(() => sharedDashboard)
  const [loading, setLoading] = useState(() => dashboardListenerCount === 0)
  const [error, setError] = useState(null)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const data = await alphaEngineService.getDashboardData()
      sharedDashboard = data
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
    dashboardListenerCount++
    if (dashboardListenerCount === 1 && !dashboardIntervalId && refreshInterval > 0) {
      fetchDashboard()
      dashboardIntervalId = setInterval(fetchDashboard, refreshInterval)
    }

    return () => {
      dashboardListenerCount--
      if (dashboardListenerCount === 0 && dashboardIntervalId) {
        clearInterval(dashboardIntervalId)
        dashboardIntervalId = null
      }
    }
  }, [fetchDashboard, refreshInterval])

  return { dashboard, loading, error, refetch: fetchDashboard }
}
