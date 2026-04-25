import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Calendar from '../components/Calendar'
import { useAlphaDashboard, useAlphaSignals, useCalendarEvents } from '../hooks/useAlphaEngine.js'
import { useAuth } from '../app/AuthProvider.jsx'
import { usePendingOrders } from '../hooks/usePendingOrders.js'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap.js'
import pricesService from '../api/services/pricesService.js'
import { get } from '../api/client.js'

function coerceConfidence(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num > 1 && num <= 100) return num / 100
  if (num < 0) return 0
  if (num > 1) return 1
  return num
}

function directionFromPrediction(prediction) {
  if (typeof prediction === 'number') {
    if (prediction > 0) return 'bullish'
    if (prediction < 0) return 'bearish'
    return 'neutral'
  }

  const p = String(prediction ?? '').toUpperCase()
  if (!p) return 'neutral'
  if (p.includes('UP') || p.includes('BUY') || p.includes('LONG') || p.includes('BULL')) return 'bullish'
  if (p.includes('DOWN') || p.includes('SELL') || p.includes('SHORT') || p.includes('BEAR')) return 'bearish'
  if (p.includes('HOLD') || p.includes('FLAT') || p.includes('NEUTRAL') || p.includes('WATCH')) return 'neutral'
  return 'neutral'
}

function fmtHorizon(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}h`
  const raw = String(value).trim()
  return raw || null
}

function fmtAsOf(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function fmtPercent(value, digits = 0) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  const pct = num > 1 ? num : num * 100
  return `${pct.toFixed(digits)}%`
}

function fmtDays(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return '—'
  if (num < 1) return `${Math.round(num * 24)}h`
  return `${Math.round(num)}d`
}

function pickBackingLines(context) {
  const lines = []

  const rankingContext = context?.rankingContext ?? context?.ranking_context ?? null
  if (Array.isArray(rankingContext)) {
    for (const item of rankingContext) {
      if (typeof item !== 'string') continue
      const txt = item.trim()
      if (txt) lines.push(txt)
      if (lines.length >= 2) break
    }
  } else if (typeof rankingContext === 'string') {
    const txt = rankingContext.trim()
    if (txt) lines.push(txt)
  } else if (rankingContext && typeof rankingContext === 'object') {
    const candidate =
      rankingContext.summary ??
      rankingContext.reason ??
      rankingContext.thesis ??
      rankingContext.notes ??
      (Array.isArray(rankingContext.reasons) ? rankingContext.reasons.join(', ') : null)
    if (typeof candidate === 'string' && candidate.trim()) lines.push(candidate.trim())
  }

  const featureSnapshot = context?.featureSnapshot ?? context?.feature_snapshot ?? null
  if (featureSnapshot && typeof featureSnapshot === 'object' && !Array.isArray(featureSnapshot)) {
    const preferredKeys = ['momentum', 'trend', 'volatility', 'rsi', 'macd', 'volume', 'fragility', 'quality']
    const entries = []
    for (const key of preferredKeys) {
      if (!(key in featureSnapshot)) continue
      entries.push([key, featureSnapshot[key]])
    }
    if (entries.length === 0) {
      for (const [k, v] of Object.entries(featureSnapshot)) {
        if (entries.length >= 2) break
        entries.push([k, v])
      }
    }

    const rendered = entries
      .map(([k, v]) => {
        if (typeof v === 'string' && v.trim()) return `${k}: ${v.trim()}`
        if (typeof v === 'number' && Number.isFinite(v)) return `${k}: ${v.toFixed(2)}`
        if (typeof v === 'boolean') return v ? `${k}: yes` : null
        return null
      })
      .filter(Boolean)
      .slice(0, 2)

    if (rendered.length) lines.push(`Features â€” ${rendered.join(' Â· ')}`)
  }

  return lines.slice(0, 3)
}

function buildPredictionHeadline({ direction, confidence, rankScore, horizon }) {
  const tier = confidence == null ? 'low' : confidence >= 0.85 ? 'high' : confidence >= 0.7 ? 'mid' : confidence >= 0.55 ? 'low' : 'early'
  const horizonLabel = fmtHorizon(horizon)
  const horizonSuffix = horizonLabel ? ` â€” ${horizonLabel}` : ''

  const hasRank = typeof rankScore === 'number' && Number.isFinite(rankScore)
  const rankSuffix = hasRank ? ' (rank-backed)' : ''

  if (direction === 'bullish') {
    if (tier === 'high') return `High-conviction upside window${rankSuffix}${horizonSuffix}`
    if (tier === 'mid') return `Bullish edge building${rankSuffix}${horizonSuffix}`
    if (tier === 'early') return `Early upside read${rankSuffix}${horizonSuffix}`
    return `Upside tilt${rankSuffix}${horizonSuffix}`
  }

  if (direction === 'bearish') {
    if (tier === 'high') return `High-conviction downside risk${rankSuffix}${horizonSuffix}`
    if (tier === 'mid') return `Bearish pressure rising${rankSuffix}${horizonSuffix}`
    if (tier === 'early') return `Early downside read${rankSuffix}${horizonSuffix}`
    return `Downside tilt${rankSuffix}${horizonSuffix}`
  }

  if (tier === 'high') return `High-confidence range expectation${rankSuffix}${horizonSuffix}`
  if (tier === 'mid') return `Range-bound setup${rankSuffix}${horizonSuffix}`
  return `Neutral / watch${rankSuffix}${horizonSuffix}`
}


function transformCalendarEventsToPredictions(events) {
  return events.map(event => {
    const date = new Date(event.date)
    // Handle both prediction/ranking types - direction is already BUY/SELL from API
    const type = event.direction === 'BUY' ? 'BUY' : event.direction === 'SELL' ? 'SELL' : event.direction === 'WATCH' ? 'WATCH' : 'EVENT'
    return {
      date: date,
      type: type,
      symbol: event.symbol,
      confidence: event.confidence || 0.7,
      id: event.id || `${event.symbol}_${event.date}_${event.type}`
    }
  })
}

function transformSignalsToCalendarPredictions(signals) {
  return signals.map(signal => ({
    date: new Date(signal.timestamp || Date.now()),
    type: signal.type === 'BUY' ? 'BUY' : signal.type === 'SELL' ? 'SELL' : 'WATCH',
    symbol: signal.symbol,
    confidence: signal.confidence || 0.7,
    id: signal.id || `${signal.symbol}_${signal.timestamp}`
  }))
}

// Helper functions to transform alpha-engine data
function transformSignalsToLiveFormat(signals, priceMap) {
  return signals.map(signal => {
    const currentPrice = priceMap?.[signal.symbol]?.price || 145.32 // Fallback
    const confidence = signal.confidence || 0.7
    
    // Calculate risk/reward based on confidence and typical ratios
    const riskAmount = currentPrice * 0.02 * (2 - confidence) // 2-4% risk based on confidence
    const rewardAmount = riskAmount * 2.5 // 2.5:1 reward ratio
    
    return {
      symbol: signal.symbol,
      strategy: signal.source === 'top_ranked' ? 'Alpha Ranking' : 'Momentum Signal',
      confidence: signal.confidence,
      entry: `$${currentPrice.toFixed(2)}`,
      stop: `$${(currentPrice - riskAmount).toFixed(2)}`,
      target: `$${(currentPrice + rewardAmount).toFixed(2)}`,
      type: signal.type
    }
  })
}

function transformRankingsForTable(rankings) {
  return rankings.map(ranking => ({
    symbol: ranking.symbol,
    direction: (ranking.score ?? 0) >= 0 ? 'Bullish' : 'Bearish',
    score: ranking.score,
    confidence: ranking.confidence,
    reason: ranking.reasons?.[0] || null,
  }))
}

function transformRankingsToFeaturedAssets(rankings, priceMap) {
  return rankings.slice(0, 5).map(ranking => {
    const currentPrice = priceMap?.[ranking.symbol]?.price || 145.32 // Fallback
    const confidence = ranking.confidence || 0.7
    const score = ranking.score || 0
    
    // Calculate position size and risk based on score/confidence
    const riskAmount = currentPrice * 0.025 * (2 - confidence) // 2.5-5% risk based on confidence
    const rewardAmount = riskAmount * (2 + Math.abs(score) * 0.5) // Higher reward for stronger signals
    
    return {
      symbol: ranking.symbol,
      prediction: ranking.rank > 0 ? 'Bullish' : 'Bearish',
      thesis: ranking.reasons?.slice(0, 2).join(', ') || 'Strong technical signal detected',
      conviction: ranking.confidence > 0.8 ? 'HIGH' : ranking.confidence > 0.6 ? 'MEDIUM' : 'LOW',
      entry: `$${currentPrice.toFixed(2)}`,
      stop: `$${(currentPrice - riskAmount).toFixed(2)}`,
      target: `$${(currentPrice + rewardAmount).toFixed(2)}`,
      riskReward: `${(rewardAmount / riskAmount).toFixed(1)}:1`,
      timeHorizon: '3-5d'
    }
  })
}

export default function Landing() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [selectedSignal, setSelectedSignal] = useState(null)
  const [predictionsIndex, setPredictionsIndex] = useState({ loading: false, error: null, items: [] })
  const [predictionContexts, setPredictionContexts] = useState({ loading: false, error: null, items: [] })

  // Dashboard bootstrap - consolidates multiple API calls into one
  const { data: dashboardData, loading: dashboardLoading } = useDashboardBootstrap({ refreshInterval: 60000 })

  // Portfolio performance data (includes strategies and executions)
  const { stats: portfolioStats, strategies, loading: portfolioLoading, executions, priceMap } = usePortfolio({
    bootstrapData: dashboardData
  })

  const { pendingOrders, cancelOrder, isCanceling } = usePendingOrders({
    enabled: Boolean(user),
    pollIntervalMs: 10000,
    executions
  })

  // Alpha Engine data - defer signals to reduce startup load
  const { dashboard, loading: alphaDashboardLoading, error: dashboardError } = useAlphaDashboard({ refreshInterval: 0 })
  const [signals, setSignals] = useState([])
  const [signalsLoading, setSignalsLoading] = useState(false)

  // Load signals after initial render to reduce startup requests
  useEffect(() => {
    const loadSignals = async () => {
      setSignalsLoading(true)
      try {
        const data = await get('/engine/signals/active')
        setSignals(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('Failed to load signals:', err)
      } finally {
        setSignalsLoading(false)
      }
    }
    // Defer by 1 second to prioritize critical data
    const timer = setTimeout(loadSignals, 1000)
    return () => clearTimeout(timer)
  }, [])

  // Calendar events - defer to reduce startup load
  const [calendarEvents, setCalendarEvents] = useState([])
  const [calendarSummary, setCalendarSummary] = useState(null)
  const [calendarLoading, setCalendarLoading] = useState(false)

  useEffect(() => {
    const loadCalendar = async () => {
      setCalendarLoading(true)
      try {
        const data = await get('/engine/calendar?limit=50&distribution=uniform&min_days=12')
        setCalendarEvents(data.events || [])
        setCalendarSummary({
          eventCount: data.eventCount || 0,
          minimumExpected: data.minimumExpected || 10,
          meetsMinimum: data.meetsMinimum || false,
          countsByType: data.countsByType || {},
          distinctDays: data.distinctDays || 0,
          minimumDaysTarget: data.minimumDaysTarget || 12,
          meetsDayTarget: data.meetsDayTarget || false,
          distribution: data.distribution || 'uniform'
        })
      } catch (err) {
        console.error('Failed to load calendar:', err)
      } finally {
        setCalendarLoading(false)
      }
    }
    // Defer by 1.5 seconds to prioritize critical data
    const timer = setTimeout(loadCalendar, 1500)
    return () => clearTimeout(timer)
  }, [])

  const predictionIdsToLoad = useMemo(() => {
    const list = Array.isArray(predictionsIndex.items) ? [...predictionsIndex.items] : []
    list.sort((a, b) => {
      const confDelta = (Number(b?.confidence ?? 0) || 0) - (Number(a?.confidence ?? 0) || 0)
      if (confDelta !== 0) return confDelta
      const bt = Number(b?.predictedAt ?? b?.createdAt ?? 0) || 0
      const at = Number(a?.predictedAt ?? a?.createdAt ?? 0) || 0
      return bt - at
    })
    const ids = []
    for (const row of list) {
      const id = String(row?.id ?? '').trim()
      if (!id) continue
      if (ids.includes(id)) continue
      ids.push(id)
      if (ids.length >= 6) break
    }
    return ids
  }, [predictionsIndex.items])

  // Defer predictions to reduce startup load
  useEffect(() => {
    let cancelled = false
    setPredictionsIndex({ loading: true, error: null, items: [] })

    const loadPredictions = async () => {
      get('/predictions')
        .then((rows) => {
          if (cancelled) return
          const items = Array.isArray(rows) ? rows : []
          setPredictionsIndex({ loading: false, error: null, items })
        })
        .catch((error) => {
          if (cancelled) return
          setPredictionsIndex({ loading: false, error: error?.message || 'Failed to load predictions', items: [] })
        })
    }

    // Defer by 2 seconds to prioritize critical data
    const timer = setTimeout(loadPredictions, 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (predictionIdsToLoad.length === 0) {
      const msg = predictionsIndex.loading
        ? null
        : predictionsIndex.error
          ? predictionsIndex.error
          : 'No predictions available'
      setPredictionContexts({ loading: false, error: msg, items: [] })
      return
    }

    let cancelled = false
    setPredictionContexts((prev) => ({ ...prev, loading: true, error: null }))

    Promise.allSettled(
      predictionIdsToLoad.map((id) =>
        get(`/predictions/${encodeURIComponent(id)}/context`).then((ctx) => ({ id, ctx }))
      )
    )
      .then((results) => {
        if (cancelled) return
        const items = []
        for (const r of results) {
          if (r.status !== 'fulfilled') continue
          if (!r.value?.ctx) continue
          items.push({ id: r.value.id, ...r.value.ctx })
        }
        setPredictionContexts({
          loading: false,
          error: items.length ? null : 'No prediction context available',
          items
        })
      })
      .catch((error) => {
        if (cancelled) return
        setPredictionContexts({ loading: false, error: error?.message || 'Failed to load predictions', items: [] })
      })

    return () => {
      cancelled = true
    }
  }, [predictionIdsToLoad.join('|')])

  // Transform data for UI components
  const liveSignals = useMemo(() => transformSignalsToLiveFormat(signals || [], priceMap), [signals, priceMap])
  const engineRankings = useMemo(() => transformRankingsForTable(dashboard?.topRankings?.rankings || []), [dashboard?.topRankings?.rankings])
  const featuredAssets = useMemo(() => transformRankingsToFeaturedAssets(dashboard?.topRankings?.rankings || [], priceMap), [dashboard?.topRankings?.rankings, priceMap])
  const calendarPredictions = useMemo(() => transformCalendarEventsToPredictions(calendarEvents || []), [calendarEvents])

  const topRankings = dashboard?.topRankings || null

  const strategyPerformance = useMemo(() => {
    const executionsList = Array.isArray(executions) ? executions : []
    const strategyList = Array.isArray(strategies) ? strategies : []

    const counts = new Map()
    for (const exec of executionsList) {
      const strategyId = exec?.strategyId ?? exec?.strategy_id ?? null
      if (!strategyId) continue
      const status = String(exec?.status ?? '').toLowerCase()
      if (status && status !== 'filled' && status !== 'partially_filled') continue
      counts.set(strategyId, (counts.get(strategyId) ?? 0) + 1)
    }

    const byId = new Map()
    for (const strat of strategyList) {
      const id = strat?.id ?? strat?.strategyId ?? strat?.strategy_id ?? null
      if (!id) continue
      byId.set(id, strat)
    }

    const ids = new Set([...counts.keys(), ...byId.keys()])
    const rows = []
    for (const id of ids) {
      const strat = byId.get(id) ?? {}
      const name =
        strat?.name ??
        strat?.title ??
        (typeof id === 'string' && id.trim() ? `Strategy ${id.slice(0, 8)}` : 'Strategy')

      const trades = counts.get(id) ?? 0
      const winRateRaw = strat?.win_rate ?? strat?.winRate ?? strat?.winrate ?? null
      const edgeRaw = strat?.edge ?? strat?.return ?? strat?.roi ?? null
      const avgHoldRaw = strat?.avg_hold_days ?? strat?.avgHoldDays ?? strat?.avg_hold ?? strat?.avgHold ?? null

      const statusRaw = strat?.status ?? strat?.state ?? null
      const status = typeof statusRaw === 'string' && statusRaw.trim()
        ? statusRaw.trim().toUpperCase()
        : trades > 0 ? 'ACTIVE' : 'IDLE'

      rows.push({
        id: String(id),
        name,
        trades,
        edge: typeof edgeRaw === 'string' && edgeRaw.trim() ? edgeRaw.trim() : fmtPercent(edgeRaw, 1),
        winRate: typeof winRateRaw === 'string' && winRateRaw.trim() ? winRateRaw.trim() : fmtPercent(winRateRaw, 0),
        avgHold: typeof avgHoldRaw === 'string' && avgHoldRaw.trim() ? avgHoldRaw.trim() : fmtDays(avgHoldRaw),
        status
      })
    }

    rows.sort((a, b) => (b.trades ?? 0) - (a.trades ?? 0))
    return rows.slice(0, 12)
  }, [executions, strategies])

  const predictionCards = useMemo(() => {
    const list = Array.isArray(predictionContexts.items) ? predictionContexts.items : []
    const cards = list.map((ctx) => {
      const ticker = String(ctx?.ticker ?? ctx?.symbol ?? '').toUpperCase().trim()
      const confidence = coerceConfidence(ctx?.confidence)
      const direction = directionFromPrediction(ctx?.prediction)
      const rankScoreRaw = ctx?.rankScore ?? ctx?.rank_score
      const rankScore = typeof rankScoreRaw === 'number' ? rankScoreRaw : Number(rankScoreRaw)

      return {
        id: String(ctx?.predictionId ?? ctx?.prediction_id ?? ctx?.id ?? '').trim() || ticker,
        predictionId: String(ctx?.predictionId ?? ctx?.prediction_id ?? ctx?.id ?? '').trim() || null,
        tenantId: String(ctx?.tenant_id ?? ctx?.tenantId ?? '').trim() || null,
        ticker,
        timestamp: ctx?.timestamp ?? ctx?.predictedAt ?? ctx?.predicted_at ?? null,
        prediction: ctx?.prediction ?? null,
        confidence,
        horizon: ctx?.horizon ?? null,
        mode: ctx?.mode ?? null,
        strategyId: ctx?.strategyId ?? ctx?.strategy_id ?? null,
        rankScore: Number.isFinite(rankScore) ? rankScore : null,
        rankingContext: ctx?.rankingContext ?? ctx?.ranking_context ?? null,
        featureSnapshot: ctx?.featureSnapshot ?? ctx?.feature_snapshot ?? null,
        headline: buildPredictionHeadline({
          direction,
          confidence,
          rankScore: Number.isFinite(rankScore) ? rankScore : null,
          horizon: ctx?.horizon ?? null
        }),
        backingLines: pickBackingLines(ctx),
        direction
      }
    })

    cards.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    return cards.filter((c) => c.ticker).slice(0, 6)
  }, [predictionContexts.items])

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem 1rem 3rem' }}>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Performance Today</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">Daily P&L</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: portfolioStats?.totalReturn > 0 ? '#1f8a4c' : '#c0392b' }}>
              ${portfolioLoading ? '...' : portfolioStats ? portfolioStats.totalReturn.toFixed(2) : '0.00'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <div>
                <div className="muted">Win Rate</div>
                <div style={{ fontWeight: 600 }}>
                  {portfolioLoading ? '...' : portfolioStats ? (portfolioStats.winRate / 100).toFixed(3) : '0.000'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="muted">Total Trades</div>
                <div style={{ fontWeight: 600 }}>
                  {portfolioLoading ? '...' : portfolioStats ? portfolioStats.totalTrades : '0'}
                </div>
              </div>
            </div>
          </div>
        </article>

      {/* Alpha Engine Status */}
      {dashboardError && (
        <section style={{ 
          background: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: 12, 
          padding: '1rem', 
          marginBottom: '1rem' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: '#c0392b' 
            }} />
            <strong style={{ color: '#c0392b' }}>Alpha Engine Connection Error</strong>
          </div>
          <div style={{ fontSize: '14px', color: '#c0392b', marginTop: '0.5rem' }}>
            {dashboardError}
          </div>
        </section>
      )}

      {/* Live Signals & Predictions */}
      <section style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <div className='signal-box-4' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Live Signals</strong>
            <div style={{ fontSize: '12px', color: '#7a7a7a' }}>
              {signalsLoading ? 'Loading...' : `${liveSignals.length} active`}
            </div>
          </div>
          <div style={{ marginTop: '0.8rem', maxHeight: '300px', overflowY: 'auto' }}>
            {signalsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                Loading signals from Alpha Engine...
              </div>
            ) : liveSignals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                No active signals available
              </div>
            ) : (
              liveSignals.map((signal, index) => (
                <div
                  key={`${signal.symbol}-${index}`}
                  style={{
                    borderBottom: '1px solid #eee',
                    paddingBottom: '0.8rem',
                    marginBottom: '0.8rem',
                    cursor: 'pointer',
                    backgroundColor: selectedSignal?.symbol === signal.symbol ? '#f8f9fa' : 'transparent',
                    padding: '0.5rem',
                    borderRadius: '8px'
                  }}
                  onClick={() => setSelectedSignal(signal)}
                >
                  <div className='signal-box-1' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '16px' }}>{signal.symbol}</div>
                      <div className="muted" style={{ fontSize: '12px' }}>{signal.strategy}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        backgroundColor: signal.confidence > 0.8 ? '#1f8a4c' : signal.confidence > 0.7 ? '#f39c12' : '#e74c3c',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600
                      }}>
                        {(signal.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '12px' }}>
                    <div>
                      <span className="muted">Entry:</span> {signal.entry}
                    </div>
                    <div>
                      <span className="muted">Stop:</span> {signal.stop}
                    </div>
                    <div>
                      <span className="muted">Target:</span> {signal.target}
                    </div>
                    <div>
                      <span className="muted">Type:</span> {signal.type}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <div>
            <strong>Top Picks</strong>
            <div style={{ fontSize: '12px', color: '#7a7a7a', marginTop: '0.2rem' }}>Highest-conviction names right now</div>
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '0.8rem' }}>
            {dashboardLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                Loading...
              </div>
            ) : dashboardError ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#c0392b', fontSize: '13px' }}>
                Engine offline — picks unavailable
              </div>
            ) : engineRankings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                No picks yet
              </div>
            ) : (
              engineRankings.map((item, index) => (
                <div key={`${item.symbol}-${index}`} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.65rem', marginBottom: '0.65rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                      <strong style={{ fontSize: '14px' }}>{item.symbol}</strong>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: item.direction === 'Bullish' ? '#1f8a4c' : '#c0392b'
                      }}>
                        {item.direction === 'Bullish' ? '↑' : '↓'} {item.direction}
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: '11px' }}>
                      {(item.confidence * 100).toFixed(0)}% conviction
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '0.25rem', lineHeight: 1.4 }}>
                    {item.reason || 'Strong technical setup detected'}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      {/* Predictions (Context) */}
      <section style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
          <div>
            <strong>Predictions</strong>
          </div>
          <div style={{ fontSize: '12px', color: '#7a7a7a' }}>
            {predictionContexts.loading ? 'Loading...' : predictionCards.length ? `${predictionCards.length} shown` : '—'}
          </div>
        </div>

        {predictionContexts.error && !predictionContexts.loading && predictionCards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.25rem', color: '#666' }}>
            {predictionContexts.error}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.8rem', marginTop: '0.9rem' }}>
            {Array.from({ length: predictionContexts.loading && predictionCards.length === 0 ? 3 : 0 }).map((_, idx) => (
              <div
                key={`pred-skel-${idx}`}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 16,
                  padding: '1rem',
                  background: 'linear-gradient(180deg, #fafafa, #ffffff)'
                }}
              >
                <div style={{ height: 12, width: '55%', background: '#f1f3f5', borderRadius: 8 }} />
                <div style={{ height: 18, width: '90%', background: '#f1f3f5', borderRadius: 8, marginTop: 10 }} />
                <div style={{ height: 10, width: '70%', background: '#f1f3f5', borderRadius: 8, marginTop: 12 }} />
              </div>
            ))}

            {predictionCards.map((card) => {
              const tone = card.direction === 'bullish' ? '#1f8a4c' : card.direction === 'bearish' ? '#c0392b' : '#6c757d'
              const confPct = card.confidence == null ? null : Math.round(card.confidence * 100)
              const asOf = fmtAsOf(card.timestamp)
              const mode = card.mode ? String(card.mode).toUpperCase() : null
              const horizon = fmtHorizon(card.horizon)

              return (
                <div
                  key={card.id}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 16,
                    padding: '1rem',
                    background: 'linear-gradient(180deg, #ffffff, #fbfbfd)',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: tone }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 16 }}>{card.ticker}</strong>
                      <span style={{
                        backgroundColor: tone,
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: '11px',
                        fontWeight: 700
                      }}>
                        {card.direction === 'bullish' ? 'BULLISH' : card.direction === 'bearish' ? 'BEARISH' : 'NEUTRAL'}
                      </span>
                      {confPct != null && (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: tone }}>
                          {confPct}% conf
                        </span>
                      )}
                    </div>

                    <button
                      className="ghost pressable"
                      onClick={() => navigate(`/orders?ticker=${encodeURIComponent(card.ticker)}`)}
                      style={{ padding: '0.4rem 0.7rem', fontSize: '12px' }}
                    >
                      Open
                    </button>
                  </div>

                  <div style={{ marginTop: '0.55rem', lineHeight: 1.25 }}>
                    <strong style={{ fontSize: '14px' }}>{card.headline}</strong>
                    {asOf && (
                      <div className="muted" style={{ fontSize: '12px', marginTop: 6 }}>
                        As of {asOf}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.7rem' }}>
                    {card.rankScore != null && (
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>
                        Rank {card.rankScore >= 0 ? '+' : ''}{card.rankScore.toFixed(2)}
                      </span>
                    )}
                    {mode && (
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>
                        Mode {mode}
                      </span>
                    )}
                    {horizon && (
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>
                        Horizon {horizon}
                      </span>
                    )}
                    {card.strategyId && (
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>
                        Strategy {String(card.strategyId).slice(0, 10)}
                      </span>
                    )}
                  </div>

                  {card.backingLines.length > 0 && (
                    <div style={{ marginTop: '0.75rem', fontSize: '12px', color: '#444', lineHeight: 1.35 }}>
                      {card.backingLines.slice(0, 2).map((line) => (
                        <div key={line} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <span style={{ color: tone, fontWeight: 900 }}>â€¢</span>
                          <span style={{ flex: 1 }}>{line}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>


      {/* Featured Assets with Enhanced Details */}
      <section style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)', marginBottom: '1rem' }}>
        <strong>Featured Assets</strong>
        <div style={{ display: 'grid', gap: '0.8rem', marginTop: '0.8rem' }}>
          {dashboardLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
              Loading featured assets from Alpha Engine...
            </div>
          ) : featuredAssets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
              No featured assets available
            </div>
          ) : (
            featuredAssets.map((asset) => (
            <div key={asset.symbol} style={{
              border: '1px solid #eee',
              borderRadius: 12,
              padding: '1rem',
              backgroundColor: asset.conviction === 'HIGH' ? '#f8f9fa' : 'white'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <strong style={{ fontSize: '18px' }}>{asset.symbol}</strong>
                    <span style={{
                      backgroundColor: asset.prediction.includes('Bullish') ? '#1f8a4c' : asset.prediction.includes('Neutral') ? '#f39c12' : '#e74c3c',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 600
                    }}>
                      {asset.prediction}
                    </span>
                    {asset.conviction === 'HIGH' && (
                      <span style={{
                        backgroundColor: '#6c5ce7',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600
                      }}>
                        HIGH CONVICTION
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ marginTop: '0.3rem', fontSize: '14px' }}>{asset.thesis}</div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '12px' }}>
                    <div>
                      <span className="muted">Entry:</span> ${asset.entry}
                    </div>
                    <div>
                      <span className="muted">Stop:</span> ${asset.stop}
                    </div>
                    <div>
                      <span className="muted">Target:</span> ${asset.target}
                    </div>
                    <div>
                      <span className="muted">R:R</span> {asset.riskReward}
                    </div>
                    <div>
                      <span className="muted">Horizon:</span> {asset.timeHorizon}
                    </div>
                  </div>
                </div>
                <button
                  className="ghost pressable"
                  onClick={() => navigate(`/orders?ticker=${encodeURIComponent(asset.symbol)}`)}
                  style={{ padding: '0.5rem 1rem', fontSize: '12px' }}
                >
                  Analyze
                </button>
              </div>
            </div>
          )))}
        </div>
      </section>

      {/* Strategy Performance & Recent Trades */}
      <section style={{ marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Strategy Performance</strong>
          <div style={{ marginTop: '0.8rem', maxHeight: '300px', overflowY: 'auto' }}>
            {strategyPerformance.length === 0 ? (
              <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>
                No strategy stats available yet.
              </div>
            ) : strategyPerformance.map((strategy) => (
              <div key={strategy.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto',
                gap: '0.5rem',
                borderBottom: '1px solid #eee',
                paddingBottom: '0.5rem',
                marginBottom: '0.5rem',
                alignItems: 'center',
                fontSize: '12px'
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{strategy.name}</div>
                  <div className="muted">{strategy.trades} trades</div>
                </div>
                <div style={{ color: '#1f8a4c', fontWeight: 700 }}>{strategy.edge}</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{strategy.winRate}</div>
                  <div className="muted">Win Rate</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{strategy.avgHold}</div>
                  <div className="muted">Avg Hold</div>
                </div>
                <div>
                  <span style={{
                    backgroundColor: strategy.status === 'ACTIVE' ? '#1f8a4c' : '#e74c3c',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '8px',
                    fontSize: '10px',
                    fontWeight: 600
                  }}>
                    {strategy.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>

      </section>

      {/* Trading Calendar */}
      <section style={{ background: 'white', borderRadius: 24, padding: '2rem', boxShadow: '0 8px 26px rgba(0,0,0,0.06)', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="eyebrow">Trading Calendar</div>
        </div>

        <Calendar predictions={calendarPredictions} />

        {/* Call to Action */}
        <div style={{ textAlign: 'center', marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #e9ecef' }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '1rem' }}>Never miss a trading opportunity</h3>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>
            Get instant notifications when our Alpha Engine generates new signals or targets are reached.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="ghost pressable" onClick={() => navigate('/assets')}>
              Assets
            </button>
            <button className="primary pressable" onClick={() => navigate('/portfolio')}>
              Portfolio
            </button>
            <button className="ghost pressable" onClick={() => navigate('/bots')}>
              Bots
            </button>
          </div>
        </div>
      </section>

      {/* System Health & Automation */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>System Health</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">Bots Online</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>9 / 10</div>
            <div style={{ color: '#1f8a4c', fontWeight: 600, fontSize: '14px' }}>Execution latency normal</div>
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Risk Metrics</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">Portfolio Heat</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>6.8%</div>
            <div style={{ color: '#f39c12', fontWeight: 600, fontSize: '14px' }}>Within limits</div>
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Prediction Quality</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">7-day precision</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>71%</div>
            <div style={{ color: '#1f8a4c', fontWeight: 600, fontSize: '14px' }}>Improving trend</div>
          </div>
        </article>
      </section>

      {/* What We Do Section */}
      <section style={{ background: 'white', borderRadius: 24, padding: '2rem', boxShadow: '0 8px 26px rgba(0,0,0,0.06)', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'right', fontSize: '12px', color: '#7a7a7a' }}>
          <div>Last Update</div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>{currentTime.toLocaleTimeString()}</div>
        </div>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 style={{ margin: '0.5rem 0', fontSize: '2rem', fontWeight: 700, lineHeight: 1.2 }}>Algorithmic Trading Made Intelligent</h2>
          <p className="muted" style={{ maxWidth: 600, margin: '0 auto', fontSize: '18px', lineHeight: 1.5 }}>
            Lumantic transforms complex market data into actionable trading intelligence through advanced machine learning and automated execution.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>#</div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111' }}>Signal Generation</h3>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Our Alpha Engine analyzes thousands of data points in real-time to generate high-confidence trading signals across multiple strategies and timeframes.
            </p>
            <button className="ghost pressable" style={{ marginTop: '1rem', fontSize: '14px' }} onClick={() => navigate('/signals')}>
              Learn More
            </button>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>#</div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111' }}>Risk Management</h3>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Sophisticated position sizing, stop-loss management, and portfolio heat controls protect capital while maximizing opportunity capture.
            </p>
            <button className="ghost pressable" style={{ marginTop: '1rem', fontSize: '14px' }} onClick={() => navigate('/risk')}>
              Learn More
            </button>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>#</div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111' }}>Automated Execution</h3>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Lightning-fast trade execution with minimal latency ensures signals are captured at optimal prices across multiple market conditions.
            </p>
            <button className="ghost pressable" style={{ marginTop: '1rem', fontSize: '14px' }} onClick={() => navigate('/bots')}>
              Start a Bot
            </button>
          </div>
        </div>
        
      </section>
    </div>
  )
}
