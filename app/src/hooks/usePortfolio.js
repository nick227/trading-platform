import { useState, useEffect, useCallback } from 'react'
import executionsService from '../api/services/executionsService.js'
import pricesService from '../api/services/pricesService.js'
import { get } from '../api/client.js'
import { derivePositions } from '../services/derivePositions.js'
import { FALLBACK_STOCKS } from '../services/marketData.js'
import { usePolling } from './usePolling.js'

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
  return executions.slice(0, 5).map(e => ({
    event: `${e.side === 'BUY' ? 'Bought' : 'Sold'} ${e.ticker}`,
    value: `${e.side === 'BUY' ? '+' : '-'}$${(e.price * e.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    time: formatTimeAgo(e.createdAt),
    type: e.side === 'BUY' ? 'buy' : 'sell'
  }))
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
  const [holdings, setHoldings] = useState([])
  const [stats, setStats] = useState(null)
  const [recentActivity, setRecentActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch executions, bots, prices, and performance data in parallel
      const [executions, botsResponse, priceMap, performanceStats] = await Promise.all([
        executionsService.getAll(),
        get('/bots').catch(() => []),
        pricesService.getPriceMap(),
        get('/performance/stats').catch(() => null),
      ])

      // Strategies from engine (may be unavailable)
      let strategies = []
      try {
        const raw = await get('/strategies')
        strategies = Array.isArray(raw) ? raw : []
      } catch { /* engine offline */ }

      // Derive settled positions (FIFO, single source of truth)
      const positions = derivePositions(executions)

      // Compute total market value for weight %
      const totalMarketValue = positions.reduce((sum, pos) => {
        const price = pricesService.getPrice(priceMap, pos.ticker) ?? pos.avgCost
        return sum + pos.quantity * price
      }, 0)

      const nextHoldings = buildHoldings(positions, executions, priceMap, totalMarketValue)
      const nextStats = buildStats(nextHoldings, executions, botsResponse, strategies, performanceStats)
      const nextActivity = buildRecentActivity(executions)

      setHoldings(nextHoldings)
      setStats(nextStats)
      setRecentActivity(nextActivity)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Background refresh every 60 s so the portfolio stays reasonably current
  // without requiring a page reload.
  usePolling(load, 60000)

  return { holdings, stats, recentActivity, loading, error, refetch: load }
}
