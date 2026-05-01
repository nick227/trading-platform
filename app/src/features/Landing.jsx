import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Calendar from '../components/Calendar'
import Section from '../components/Section'
import { SkeletonRows, TickerRow3 } from './assets/components.jsx'
import { useAlphaDashboard } from '../hooks/useAlphaEngine.js'
import { useAuth } from '../app/AuthProvider.jsx'
import { usePendingOrders } from '../hooks/usePendingOrders.js'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap.js'
import { alphaFetch } from '../api/services/alphaEngineService.js'
import { get } from '../api/client.js'
import pageTitleService from '../services/pageTitleService.js'
import { DEFAULT_MODE, RECOMMENDATION_CAPS } from './assets/constants.js'
import {
  fmtPct, fmtPrice, fmtScore, fmtAsOf, normalizeConfidence,
  deriveRowPrice, normalizeSymbol
} from './assets/utils.js'

// ─── Prediction helpers ───────────────────────────────────────────────────────

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
  return 'neutral'
}

function fmtHorizon(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}h`
  const raw = String(value).trim()
  return raw || null
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
      rankingContext.summary ?? rankingContext.reason ?? rankingContext.thesis ?? rankingContext.notes ??
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
    if (rendered.length) lines.push(`Features — ${rendered.join(' · ')}`)
  }

  return lines.slice(0, 3)
}

function buildPredictionHeadline({ direction, confidence, rankScore, horizon }) {
  const tier = confidence == null ? 'low' : confidence >= 0.85 ? 'high' : confidence >= 0.7 ? 'mid' : confidence >= 0.55 ? 'low' : 'early'
  const horizonLabel = fmtHorizon(horizon)
  const horizonSuffix = horizonLabel ? ` — ${horizonLabel}` : ''
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
    const type = event.direction === 'BUY' ? 'BUY' : event.direction === 'SELL' ? 'SELL' : event.direction === 'WATCH' ? 'WATCH' : 'EVENT'
    return {
      date,
      type,
      symbol: event.symbol,
      confidence: event.confidence || 0.7,
      id: event.id || `${event.symbol}_${event.date}_${event.type}`
    }
  })
}

function transformSignalsToLiveFormat(signals, priceMap) {
  return signals.map(signal => {
    const currentPrice = priceMap?.[signal.symbol]?.price || 145.32
    const confidence = signal.confidence || 0.7
    const riskAmount = currentPrice * 0.02 * (2 - confidence)
    const rewardAmount = riskAmount * 2.5
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Landing() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [selectedSignal, setSelectedSignal] = useState(null)
  const [predictionsIndex, setPredictionsIndex] = useState({ loading: false, error: null, items: [] })
  const [predictionContexts, setPredictionContexts] = useState({ loading: false, error: null, items: [] })
  const [spotQuotes, setSpotQuotes] = useState({})

  useEffect(() => {
    pageTitleService.setHomeTitle('Home Dashboard')
    pageTitleService.setTitle('Home')
  }, [])

  const { data: dashboardData } = useDashboardBootstrap({ refreshInterval: 60000 })

  const { stats: portfolioStats, strategies, loading: portfolioLoading, executions, priceMap } = usePortfolio({
    bootstrapData: dashboardData
  })

  const { pendingOrders, cancelOrder, isCanceling } = usePendingOrders({
    enabled: Boolean(user),
    pollIntervalMs: 10000,
    executions
  })

  const { error: dashboardError } = useAlphaDashboard({ refreshInterval: 0 })

  // Signals — deferred 1s to prioritise critical data
  const [signals, setSignals] = useState([])
  const [signalsLoading, setSignalsLoading] = useState(false)
  useEffect(() => {
    const load = async () => {
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
    const t = setTimeout(load, 1000)
    return () => clearTimeout(t)
  }, [])

  // Calendar — deferred 1.5s
  const [calendarEvents, setCalendarEvents] = useState([])
  useEffect(() => {
    const load = async () => {
      try {
        const data = await get('/engine/calendar?limit=50&distribution=uniform&min_days=12')
        setCalendarEvents(data.events || [])
      } catch (err) {
        console.error('Failed to load calendar:', err)
      }
    }
    const t = setTimeout(load, 1500)
    return () => clearTimeout(t)
  }, [])

  // Spot quotes for Market Context ETF prices
  const fetchSpotQuotes = useCallback(async () => {
    try {
      const result = await alphaFetch('/api/quotes?symbols=SPY,QQQ,IWM')
      const quotesData = Array.isArray(result) ? result : result?.data || []
      const next = {}
      for (const quote of quotesData) {
        if (quote && !quote.error) next[normalizeSymbol(quote.symbol)] = quote
      }
      setSpotQuotes(next)
    } catch {
      // non-critical; Market Context still shows regime
    }
  }, [])

  useEffect(() => { fetchSpotQuotes() }, [fetchSpotQuotes])

  // Section fetchers
  const fetchMarketSection = useCallback(async () => {
    const regime = await alphaFetch('/api/regime/SPY')
    return { regime }
  }, [])

  const fetchRankingsSection = useCallback(async () => {
    return alphaFetch('/rankings/top?limit=25&maxFragility=0.40')
  }, [])

  const fetchMoversSection = useCallback(async () => {
    return alphaFetch('/rankings/movers?limit=25')
  }, [])

  const fetchRecsSection = useCallback(async () => {
    const caps = [2, 10, 100]
    const results = await Promise.all(
      caps.map((cap) =>
        alphaFetch(`/recommendations/under/${cap}?mode=${DEFAULT_MODE}&limit=25`).then((data) => [cap, data])
      )
    )
    const next = {}
    for (const [cap, data] of results) next[cap] = data
    return next
  }, [])

  // Predictions — deferred 2s
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
      if (!id || ids.includes(id)) continue
      ids.push(id)
      if (ids.length >= 6) break
    }
    return ids
  }, [predictionsIndex.items])

  useEffect(() => {
    let cancelled = false
    setPredictionsIndex({ loading: true, error: null, items: [] })
    const load = () => {
      get('/predictions')
        .then((rows) => {
          if (cancelled) return
          setPredictionsIndex({ loading: false, error: null, items: Array.isArray(rows) ? rows : [] })
        })
        .catch((error) => {
          if (cancelled) return
          setPredictionsIndex({ loading: false, error: error?.message || 'Failed to load predictions', items: [] })
        })
    }
    const t = setTimeout(load, 2000)
    return () => { cancelled = true; clearTimeout(t) }
  }, [])

  useEffect(() => {
    if (predictionIdsToLoad.length === 0) {
      const msg = predictionsIndex.loading ? null
        : predictionsIndex.error ? predictionsIndex.error
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
    ).then((results) => {
      if (cancelled) return
      const items = []
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value?.ctx) continue
        items.push({ id: r.value.id, ...r.value.ctx })
      }
      setPredictionContexts({
        loading: false,
        error: items.length ? null : 'No prediction context available',
        items
      })
    }).catch((error) => {
      if (cancelled) return
      setPredictionContexts({ loading: false, error: error?.message || 'Failed to load predictions', items: [] })
    })
    return () => { cancelled = true }
  }, [predictionIdsToLoad.join('|')])

  // Derived data
  const liveSignals = useMemo(() => transformSignalsToLiveFormat(signals || [], priceMap), [signals, priceMap])
  const calendarPredictions = useMemo(() => transformCalendarEventsToPredictions(calendarEvents || []), [calendarEvents])

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
      if (id) byId.set(id, strat)
    }
    const ids = new Set([...counts.keys(), ...byId.keys()])
    const rows = []
    for (const id of ids) {
      const strat = byId.get(id) ?? {}
      const name = strat?.name ?? strat?.title ??
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
        id: String(id), name, trades,
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
          direction, confidence,
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem 1rem 3rem' }}>

      {/* Row 1: Performance Today + Market Context */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
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

        <Section
          title="Market Context"
          fetcher={fetchMarketSection}
          skeleton={<div className="muted mt-2">Loading…</div>}
          render={(data) => (
            <div className="data-rows mt-2">
              {['SPY', 'QQQ', 'IWM'].map((label) => {
                const q = spotQuotes?.[normalizeSymbol(label)]
                return (
                  <TickerRow3
                    key={label}
                    ticker={label}
                    to={`/orders?ticker=${encodeURIComponent(label)}`}
                    price={fmtPrice(q?._price ?? deriveRowPrice(q))}
                    special={fmtPct(q?.dailyChangePct ?? q?.changePct ?? q?.change)}
                    specialClassName="muted text-right text-nowrap"
                  />
                )
              })}
              <div className="mt-2">
                <div className="eyebrow mb-0">Regime</div>
                <div style={{ fontWeight: 700 }}>
                  {data?.regime?.regime ?? data?.regime?.name ?? data?.regime?.state ?? '—'}
                </div>
              </div>
            </div>
          )}
        />
      </section>

      {/* Alpha Engine error */}
      {dashboardError && (
        <section style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#c0392b' }} />
            <strong style={{ color: '#c0392b' }}>Alpha Engine Connection Error</strong>
          </div>
          <div style={{ fontSize: 14, color: '#c0392b', marginTop: '0.5rem' }}>{dashboardError}</div>
        </section>
      )}

      {/* Row 2: Live Signals + Predictions */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Live Signals</strong>
            <div style={{ fontSize: 12, color: '#7a7a7a' }}>
              {signalsLoading ? 'Loading...' : `${liveSignals.length} active`}
            </div>
          </div>
          <div style={{ marginTop: '0.8rem', maxHeight: 320, overflowY: 'auto' }}>
            {signalsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>Loading signals from Alpha Engine...</div>
            ) : liveSignals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>No active signals available</div>
            ) : (
              liveSignals.map((signal, index) => (
                <div
                  key={`signal-${signal.symbol}-${index}`}
                  style={{
                    borderBottom: '1px solid #eee',
                    cursor: 'pointer',
                    backgroundColor: selectedSignal?.symbol === signal.symbol ? '#f8f9fa' : 'transparent',
                    padding: '0.5rem',
                    borderRadius: 8,
                    marginBottom: '0.3rem'
                  }}
                  onClick={() => setSelectedSignal(signal)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{signal.symbol}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{signal.strategy}</div>
                    </div>
                    <div style={{
                      backgroundColor: signal.confidence > 0.8 ? '#1f8a4c' : signal.confidence > 0.7 ? '#f39c12' : '#e74c3c',
                      color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600
                    }}>
                      {(signal.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: 12 }}>
                    <div><span className="muted">Entry:</span> {signal.entry}</div>
                    <div><span className="muted">Stop:</span> {signal.stop}</div>
                    <div><span className="muted">Target:</span> {signal.target}</div>
                    <div><span className="muted">Type:</span> {signal.type}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
            <strong>Predictions</strong>
            <div style={{ fontSize: 12, color: '#7a7a7a' }}>
              {predictionContexts.loading ? 'Loading...' : predictionCards.length ? `${predictionCards.length} shown` : '—'}
            </div>
          </div>

          {predictionContexts.error && !predictionContexts.loading && predictionCards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.25rem', color: '#666' }}>{predictionContexts.error}</div>
          ) : (
            <div style={{ marginTop: '0.9rem', maxHeight: 340, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.7rem' }}>
                {Array.from({ length: predictionContexts.loading && predictionCards.length === 0 ? 3 : 0 }).map((_, idx) => (
                  <div key={`pred-skel-${idx}`} style={{ border: '1px solid #eee', borderRadius: 16, padding: '1rem', background: 'linear-gradient(180deg, #fafafa, #ffffff)' }}>
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
                    <div key={card.id} style={{ border: '1px solid #eee', borderRadius: 16, padding: '1rem', background: 'linear-gradient(180deg, #ffffff, #fbfbfd)', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: tone }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 16 }}>{card.ticker}</strong>
                          <span style={{ backgroundColor: tone, color: 'white', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                            {card.direction === 'bullish' ? 'BULLISH' : card.direction === 'bearish' ? 'BEARISH' : 'NEUTRAL'}
                          </span>
                          {confPct != null && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: tone }}>{confPct}% conf</span>
                          )}
                        </div>
                        <button className="ghost pressable" onClick={() => navigate(`/orders?ticker=${encodeURIComponent(card.ticker)}`)} style={{ padding: '0.4rem 0.7rem', fontSize: 12 }}>
                          Open
                        </button>
                      </div>
                      <div style={{ marginTop: '0.55rem', lineHeight: 1.25 }}>
                        <strong style={{ fontSize: 14 }}>{card.headline}</strong>
                        {asOf && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>As of {asOf}</div>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.7rem' }}>
                        {card.rankScore != null && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>
                            Rank {card.rankScore >= 0 ? '+' : ''}{card.rankScore.toFixed(2)}
                          </span>
                        )}
                        {mode && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>Mode {mode}</span>}
                        {horizon && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>Horizon {horizon}</span>}
                        {card.strategyId && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>Strategy {String(card.strategyId).slice(0, 10)}</span>}
                      </div>
                      {card.backingLines.length > 0 && (
                        <div style={{ marginTop: '0.75rem', fontSize: 12, color: '#444', lineHeight: 1.35 }}>
                          {card.backingLines.slice(0, 2).map((line) => (
                            <div key={line} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                              <span style={{ color: tone, fontWeight: 900 }}>•</span>
                              <span style={{ flex: 1 }}>{line}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </article>
      </section>

      {/* Row 3: Ranked Opportunities + Top Movers */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <Section
          title="Ranked Opportunities"
          fetcher={fetchRankingsSection}
          skeleton={<div className="mt-2"><SkeletonRows count={8} /></div>}
          emptyMessage="No ranked opportunities."
          render={(data) => {
            const rows = data?.rankings || []
            return rows.length === 0 ? null : (
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {rows.slice(0, 12).map((r) => {
                  const tkr = r.ticker ?? r.symbol
                  const score = Number(r.score)
                  const conf = Number(r.conviction ?? r.confidence)
                  return (
                    <TickerRow3
                      key={`edge-${tkr}`}
                      ticker={tkr}
                      to={`/orders?ticker=${encodeURIComponent(tkr)}`}
                      price={fmtPrice(r._price ?? deriveRowPrice(r))}
                      special={`Score ${fmtScore(score)} · Conf ${fmtPct(conf)} · ${fmtPct(r.dailyChangePct)}`}
                      specialClassName="muted text-right text-nowrap"
                    />
                  )
                })}
              </div>
            )
          }}
        />

        <Section
          title="Top Movers"
          fetcher={fetchMoversSection}
          skeleton={<div className="mt-2"><SkeletonRows count={6} /></div>}
          emptyMessage="No movers data available."
          render={(data) => {
            const rows = data?.rankings || []
            return rows.length === 0 ? null : (
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {rows.slice(0, 8).map((r, idx) => {
                  const tkr = r.ticker ?? r.symbol
                  const currentRank = r.currentRank ?? r.current_rank ?? r.rank ?? null
                  const priorRank = r.priorRank ?? r.prior_rank ?? r.prevRank ?? r.previousRank ?? r.previous_rank ?? null
                  const rankChange = r.rankChange ?? r.rank_change ?? (currentRank !== null && priorRank !== null ? priorRank - currentRank : null)
                  const rankLabel = currentRank !== null
                    ? `#${currentRank}${typeof rankChange === 'number' ? ` · ${rankChange > 0 ? '+' : ''}${rankChange}` : ''}`
                    : '—'
                  return (
                    <TickerRow3
                      key={`mover-${tkr}-${idx}`}
                      ticker={tkr}
                      to={`/orders?ticker=${encodeURIComponent(tkr)}`}
                      price={fmtPrice(r._price ?? deriveRowPrice(r))}
                      special={`${rankLabel} · ${fmtPct(r.dailyChangePct ?? r.changePct ?? r.change)}`}
                      specialClassName="muted text-right text-nowrap"
                    />
                  )
                })}
              </div>
            )
          }}
        />
      </section>

      {/* Row 4: Price-Capped Recommendations */}
      <Section
        title="Price-Capped Recommendations"
        right={`Mode: ${DEFAULT_MODE}`}
        fetcher={fetchRecsSection}
        skeleton={<div className="card card-pad-sm"><SkeletonRows count={8} /></div>}
        render={(data) => (
          <div className="l-grid-3">
            {RECOMMENDATION_CAPS.map((cap) => {
              const payload = data?.[cap]
              const rows = payload?.recommendations ?? payload?.items ?? []
              const asOf = fmtAsOf(payload?.asOf ?? payload?.as_of ?? rows?.[0]?.asOf ?? rows?.[0]?.as_of)
              return (
                <article key={cap} className="card card-pad-sm">
                  <div className="l-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong>Under ${cap}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>{asOf ? `As of ${asOf}` : ' '}</span>
                  </div>
                  {Array.isArray(rows) && rows.length > 0 ? (
                    <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                      {rows.slice(0, 10).map((r) => {
                        const tkr = r.ticker ?? r.symbol
                        const conf = normalizeConfidence(r.confidence)
                        const entry = Array.isArray(r.entryZone) ? `${r.entryZone[0]} – ${r.entryZone[1]}` : r.entryZone
                        return (
                          <TickerRow3
                            key={`action-${tkr}`}
                            ticker={tkr}
                            to={`/orders?ticker=${encodeURIComponent(tkr)}`}
                            price={fmtPrice(r._price ?? deriveRowPrice(r))}
                            special={`${r.action ?? '—'}${conf !== null ? ` · ${conf}%` : ''}${entry ? ` · Entry ${entry}` : ''}`}
                            specialClassName="muted text-right text-ellipsis-one-line"
                          />
                        )
                      })}
                    </div>
                  ) : (
                    <div className="muted mt-2">No recommendations.</div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      />

      {/* Row 5: Strategy Performance */}
      <section style={{ marginBottom: '1rem', marginTop: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Strategy Performance</strong>
          <div style={{ marginTop: '0.8rem', maxHeight: 300, overflowY: 'auto' }}>
            {strategyPerformance.length === 0 ? (
              <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>No strategy stats available yet.</div>
            ) : strategyPerformance.map((strategy) => (
              <div key={strategy.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '0.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.5rem', alignItems: 'center', fontSize: 12 }}>
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
                  <span style={{ backgroundColor: strategy.status === 'ACTIVE' ? '#1f8a4c' : '#e74c3c', color: 'white', padding: '2px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600 }}>
                    {strategy.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      {/* Row 6: Trading Calendar */}
      <section style={{ background: 'white', borderRadius: 24, padding: '2rem', boxShadow: '0 8px 26px rgba(0,0,0,0.06)', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="eyebrow">Trading Calendar</div>
        </div>
        <Calendar predictions={calendarPredictions} />
        <div style={{ textAlign: 'center', marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #e9ecef' }}>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="ghost pressable" onClick={() => navigate('/assets')}>Assets</button>
            <button className="primary pressable" onClick={() => navigate('/portfolio')}>Portfolio</button>
            <button className="ghost pressable" onClick={() => navigate('/bots')}>Bots</button>
          </div>
        </div>
      </section>

    </div>
  )
}
