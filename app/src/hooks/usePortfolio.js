import { useState, useEffect, useCallback } from 'react'
import executionsService from '../api/services/executionsService.js'
import pricesService from '../api/services/pricesService.js'
import { get } from '../api/client.js'
import { derivePositions } from '../services/derivePositions.js'
import { FALLBACK_STOCKS } from '../services/marketData.js'
import { usePolling } from './usePolling.js'

// In-memory cache to prevent duplicate requests during React StrictMode double-render
let cachedBots = null
let cachedStrategies = null
let cachedPerformanceStats = null
let cacheExpiry = 0
const CACHE_TTL_MS = 30_000

// Shared state to prevent multiple polling intervals from multiple hook instances
let sharedData = {
  holdings: [],
  stats: null,
  strategies: [],
  performanceStats: null,
  recentActivity: [],
  executions: [],
  priceMap: null,
  loading: true,
  error: null,
  lastUpdate: 0
}
let pollingIntervalId = null
let listenerCount = 0

// ---------------------------------------------------------------------------
// Static reference data (synchronous — uses the exported constant, not the
// async getAvailableStocks() which returns a Promise)
// ---------------------------------------------------------------------------

const STOCK_REF = Object.fromEntries(FALLBACK_STOCKS.map(s => [s.symbol, s]))

const CLEARBIT_DOMAINS = {
  NVDA: 'nvidia.com',  AAPL: 'apple.com',   TSLA: 'tesla.com',
  MSFT: 'microsoft.com', GOOGL: 'google.com', AMZN: 'amazon.com',
  META: 'meta.com',    AMD: 'amd.com',       PLTR: 'palantir.com',
  SMCI: 'supermicro.com', GOOG: 'google.com'
}

function getStockRef(ticker) {
  const ref = STOCK_REF[ticker]
  return {
    company: ref?.name ?? ticker,
    sector: ref?.sector ?? 'Unknown',
    avatar: CLEARBIT_DOMAINS[ticker]
      ? `https://logo.clearbit.com/${CLEARBIT_DOMAINS[ticker]}`
      : `https://api.dicebear.com/7.x/initials/svg?seed=${ticker}`
  }
}

// ---------------------------------------------------------------------------
// Pure selectors (no side effects, easily testable)
// ---------------------------------------------------------------------------

export function buildHoldings(positions, executions, priceMap, totalMarketValue) {
  // Pre-compute first (oldest) buy date per ticker for ageDays.
  // Executions arrive newest-first, so iterating and overwriting leaves
  // the last write as the oldest buy — which is what we want.
  const firstBuyDate = {}
  for (const e of executions) {
    if (e.side === 'BUY') firstBuyDate[e.ticker] = e.createdAt
  }

  return positions.map(pos => {
    const ref = getStockRef(pos.ticker)
    const currentPrice = pricesService.getPrice(priceMap, pos.ticker) ?? pos.avgCost
    const marketValue = pos.quantity * currentPrice
    const changePerShare = currentPrice - pos.avgCost
    const changePct = pos.avgCost > 0 ? (changePerShare / pos.avgCost) * 100 : 0
    const weight = totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : 0
    const ageDays = firstBuyDate[pos.ticker]
      ? Math.floor((Date.now() - new Date(firstBuyDate[pos.ticker]).getTime()) / 86400000)
      : 0

    return {
      ticker: pos.ticker,
      company: ref.company,
      sector: ref.sector,
      avatar: ref.avatar,
      shares: pos.quantity,
      avgCost: pos.avgCost,
      currentPrice,
      change: changePerShare,
      changePct,
      buyIn: pos.totalCost,
      marketValue,
      weight,
      ageDays
    }
  }).sort((a, b) => b.marketValue - a.marketValue)
}

export function buildStats(holdings, executions, bots, strategies, performanceStats = null) {
  const totalValue = holdings.reduce((s, h) => s + h.marketValue, 0)
  const totalInvested = holdings.reduce((s, h) => s + h.buyIn, 0)
  const totalReturn = totalValue - totalInvested
  const totalReturnPct = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0

  // Most traded asset
  const tickerCounts = {}
  for (const e of executions) {
    tickerCounts[e.ticker] = (tickerCounts[e.ticker] || 0) + 1
  }
  const mostTradedAsset = Object.entries(tickerCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // Avg hold time across current positions
  const avgHoldTime = holdings.length > 0
    ? Math.round(holdings.reduce((s, h) => s + h.ageDays, 0) / holdings.length)
    : 0

  // Best / worst by unrealised % gain
  const sorted = [...holdings].sort((a, b) => b.changePct - a.changePct)
  const fmt = h => `${h.ticker} (${h.changePct >= 0 ? '+' : ''}${h.changePct.toFixed(1)}%)`
  const bestPerformer = sorted[0] ? fmt(sorted[0]) : null
  const worstPerformer = sorted[sorted.length - 1] ? fmt(sorted[sorted.length - 1]) : null

  // get('/bots') unwraps the { data } envelope, so bots arrives as the array directly
  const botList = Array.isArray(bots) ? bots : []
  const runningBots = botList.filter(b => b.enabled && b.status !== 'draft').length

  // Top strategy by return field (engine shape may vary)
  const strategyList = Array.isArray(strategies) ? strategies : []
  const topStrat = strategyList.slice().sort((a, b) => (b.return ?? 0) - (a.return ?? 0))[0]
  const topStrategy = topStrat
    ? { name: topStrat.name ?? 'Unknown', return: topStrat.return ?? 0 }
    : { name: 'N/A', return: 0 }

  // Use real performance stats if available, otherwise fallback to calculated values
  const realStats = performanceStats || {}

  return {
    totalValue,
    // dailyChangeAmount / dailyChangePct require OHLC history — not yet available
    dailyChangeAmount: 0,
    dailyChangePct: 0,
    totalReturn,
    totalReturnPct,
    // cashBalance not tracked in current data model
    cashBalance: 0,
    investedAmount: totalInvested,
    // Use real performance stats if available
    winRate: realStats.win_rate ?? 0,
    avgHoldTime,
    totalTrades: realStats.total_trades ?? executions.length,
    bestPerformer,
    worstPerformer,
    activeBots: { running: runningBots, total: botList.length },
    topStrategy,
    // highConfidenceWins requires prediction confidence correlation
    highConfidenceWins: realStats.high_confidence_wins ?? 0,
    mostTradedAsset: realStats.most_traded_asset ?? mostTradedAsset
  }
}

export function buildRecentActivity(executions) {
  // Sort by creation time, newest first, but only include completed, failed, or cancelled orders
  const sortedExecutions = executions
    .filter(e => e.createdAt) // Filter out any without timestamps
    .filter(e => e.status === 'filled' || e.status === 'failed' || e.status === 'cancelled') // Only show completed, failed, or cancelled orders
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  
  return sortedExecutions.slice(0, 5).map(e => {
    const isFailed = e.status === 'failed'
    const isCancelled = e.status === 'cancelled'
    const isBuy = e.side === 'BUY'
    
    if (isFailed) {
      return {
        event: `Failed ${isBuy ? 'Buy' : 'Sell'} Order: ${e.ticker}`,
        value: e.failReason || 'Order failed',
        time: formatTimeAgo(e.createdAt),
        type: 'failed',
        ticker: e.ticker,
        quantity: e.quantity,
        price: e.price
      }
    }
    
    if (isCancelled) {
      return {
        event: `Cancelled ${isBuy ? 'Buy' : 'Sell'} Order: ${e.ticker}`,
        value: e.cancelReason || 'User cancelled',
        time: formatTimeAgo(e.createdAt),
        type: 'cancelled',
        ticker: e.ticker,
        quantity: e.quantity,
        price: e.price
      }
    }
    
    // Only show as "Bought/Sold" if the order was actually filled
    return {
      event: `${isBuy ? 'Bought' : 'Sold'} ${e.ticker}`,
      value: `${isBuy ? '+' : '-'}$${(e.price * e.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      time: formatTimeAgo(e.createdAt),
      type: isBuy ? 'buy' : 'sell',
      ticker: e.ticker,
      quantity: e.quantity,
      price: e.price
    }
  })
}

function formatTimeAgo(ts) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 60)    return `${secs}s ago`
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePortfolio() {
  const [holdings, setHoldings] = useState(() => sharedData.holdings)
  const [stats, setStats] = useState(() => sharedData.stats)
  const [strategies, setStrategies] = useState(() => sharedData.strategies)
  const [performanceStats, setPerformanceStats] = useState(() => sharedData.performanceStats)
  const [recentActivity, setRecentActivity] = useState(() => sharedData.recentActivity)
  const [executions, setExecutions] = useState(() => sharedData.executions)
  const [priceMap, setPriceMap] = useState(() => sharedData.priceMap)
  const [loading, setLoading] = useState(() => sharedData.loading)
  const [error, setError] = useState(() => sharedData.error)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const now = Date.now()
      const useCache = cachedBots && cachedStrategies && cachedPerformanceStats && now < cacheExpiry

      // Fetch executions, bots, prices, and performance data in parallel
      const [executionsData, botsResponse, priceMap, performanceStats] = await Promise.all([
        executionsService.getAll(),
        useCache ? cachedBots : get('/bots').catch(() => []),
        pricesService.getPriceMap(),
        useCache ? cachedPerformanceStats : get('/performance/stats').catch(() => null),
      ])

      // Strategies from engine (may be unavailable)
      let strategies = useCache ? cachedStrategies : []
      if (!useCache) {
        try {
          const raw = await get('/strategies')
          strategies = Array.isArray(raw) ? raw : []
        } catch { /* engine offline */ }
      }

      // Update module-level cache if we fetched fresh data
      if (!useCache) {
        cachedBots = botsResponse
        cachedStrategies = strategies
        cachedPerformanceStats = performanceStats
        cacheExpiry = now + CACHE_TTL_MS
      }

      // Derive settled positions (FIFO, single source of truth)
      const positions = derivePositions(executionsData)

      // Compute total market value for weight %
      const totalMarketValue = positions.reduce((sum, pos) => {
        const price = pricesService.getPrice(priceMap, pos.ticker) ?? pos.avgCost
        return sum + pos.quantity * price
      }, 0)

      const nextHoldings = buildHoldings(positions, executionsData, priceMap, totalMarketValue)
      const nextStats = buildStats(nextHoldings, executionsData, botsResponse, strategies, performanceStats)
      const nextActivity = buildRecentActivity(executionsData)

      // Update shared state
      sharedData = {
        holdings: nextHoldings,
        stats: nextStats,
        strategies,
        performanceStats,
        recentActivity: nextActivity,
        executions: executionsData,
        priceMap,
        loading: false,
        error: null,
        lastUpdate: Date.now()
      }

      // Update local state
      setHoldings(nextHoldings)
      setStats(nextStats)
      setRecentActivity(nextActivity)
      setExecutions(executionsData)
      setStrategies(strategies)
      setPerformanceStats(performanceStats)
      setPriceMap(priceMap)
    } catch (err) {
      sharedData = { ...sharedData, loading: false, error: err.message }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // If shared data is fresh (within 5 seconds), use it instead of refetching
    const now = Date.now()
    if (sharedData.lastUpdate > 0 && now - sharedData.lastUpdate < 5000) {
      setHoldings(sharedData.holdings)
      setStats(sharedData.stats)
      setStrategies(sharedData.strategies)
      setPerformanceStats(sharedData.performanceStats)
      setRecentActivity(sharedData.recentActivity)
      setExecutions(sharedData.executions)
      setPriceMap(sharedData.priceMap)
      setLoading(sharedData.loading)
      setError(sharedData.error)
    } else {
      load()
    }
  }, [load])

  // Only start polling for the first instance of the hook
  useEffect(() => {
    listenerCount++
    if (listenerCount === 1 && !pollingIntervalId) {
      pollingIntervalId = setInterval(() => {
        load()
      }, 60000)
    }

    return () => {
      listenerCount--
      if (listenerCount === 0 && pollingIntervalId) {
        clearInterval(pollingIntervalId)
        pollingIntervalId = null
      }
    }
  }, [load])

  return { stats, loading, error, executions, performanceStats, holdings, strategies, recentActivity, refetch: load, priceMap }
}
