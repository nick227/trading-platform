import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { alphaFetch } from '../api/services/alphaEngineService.js'
import { get } from '../api/client.js'
import PriceChart from './orders/components/PriceChart.jsx'
import { formatETNextOpen, isMarketClosed } from '../utils/market.js'

const WATCHLIST_KEY = 'watchlist_v1'
const DEFAULT_MODE = 'balanced'

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch {
    return []
  }
}

function saveWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

function transformHistory(data) {
  const points = Array.isArray(data?.points) ? data.points : []
  return points.map((point) => {
    const dt = new Date(point.t)
    const close = point.c ?? point.close ?? 0
    const open = point.o ?? point.open ?? close
    const high = point.h ?? point.high ?? close
    const low = point.l ?? point.low ?? close
    const volume = point.v ?? point.volume ?? 0

    return {
      ts: Number.isFinite(dt.getTime()) ? dt.getTime() : null,
      date: Number.isFinite(dt.getTime()) ? dt.toISOString().split('T')[0] : null,
      open,
      high,
      low,
      close,
      volume,
      price: close,
    }
  })
}

function computeRange(points) {
  if (!Array.isArray(points) || points.length === 0) return { min: 0, max: 0, range: 0 }
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const low = Number.isFinite(p?.low) ? p.low : null
    const high = Number.isFinite(p?.high) ? p.high : null
    if (low == null || high == null) continue
    if (low < min) min = low
    if (high > max) max = high
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0, range: 0 }
  return { min, max, range: max - min }
}

function fmtMoney(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function fmtNumber(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString()
}

function fmtPct(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

function fmtAsOf(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function normalizeConfidence(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num <= 1) return Math.round(num * 100)
  if (num <= 100) return Math.round(num)
  return null
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="eyebrow mb-0">{label}</div>
      <div style={{ fontWeight: 700 }}>{value ?? '—'}</div>
    </div>
  )
}

export default function Asset() {
  const { ticker } = useParams()
  const navigate = useNavigate()
  const symbol = String(ticker ?? '').toUpperCase().trim()

  const [chartRange, setChartRange] = useState('1Y')
  const [watchlist, setWatchlist] = useState(() => loadWatchlist())
  const watched = watchlist.includes(symbol)

  const [marketClock, setMarketClock] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [quote, setQuote] = useState(null)
  const [stats, setStats] = useState(null)
  const [company, setCompany] = useState(null)
  const [regime, setRegime] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [consensus, setConsensus] = useState(null)
  const [attribution, setAttribution] = useState(null)
  const [recommendation, setRecommendation] = useState(null)

  const [history, setHistory] = useState([])
  const [priceRange, setPriceRange] = useState({ min: 0, max: 0, range: 0 })
  const [chartLoading, setChartLoading] = useState(true)

  useEffect(() => {
    setWatchlist(loadWatchlist())
  }, [symbol])

  useEffect(() => {
    let cancelled = false
    get('/alpaca/market-clock')
      .then((data) => {
        if (cancelled) return
        setMarketClock(data)
      })
      .catch(() => {
        if (cancelled) return
        setMarketClock(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!symbol) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.allSettled([
      alphaFetch(`/api/quote/${encodeURIComponent(symbol)}`),
      alphaFetch(`/api/stats/${encodeURIComponent(symbol)}`),
      alphaFetch(`/api/company/${encodeURIComponent(symbol)}`),
      alphaFetch(`/api/regime/${encodeURIComponent(symbol)}`),
      alphaFetch(`/api/ticker/${encodeURIComponent(symbol)}/accuracy`),
      alphaFetch(`/api/consensus/signals?ticker=${encodeURIComponent(symbol)}`),
      alphaFetch(`/api/ticker/${encodeURIComponent(symbol)}/attribution`),
      alphaFetch(`/recommendations/${encodeURIComponent(symbol)}?mode=${DEFAULT_MODE}`),
    ])
      .then((results) => {
        if (cancelled) return
        const [
          quoteRes,
          statsRes,
          companyRes,
          regimeRes,
          accuracyRes,
          consensusRes,
          attributionRes,
          recommendationRes,
        ] = results

        setQuote(quoteRes.status === 'fulfilled' ? quoteRes.value : null)
        setStats(statsRes.status === 'fulfilled' ? statsRes.value : null)
        setCompany(companyRes.status === 'fulfilled' ? companyRes.value : null)
        setRegime(regimeRes.status === 'fulfilled' ? regimeRes.value : null)
        setAccuracy(accuracyRes.status === 'fulfilled' ? accuracyRes.value : null)
        setConsensus(consensusRes.status === 'fulfilled' ? consensusRes.value : null)
        setAttribution(attributionRes.status === 'fulfilled' ? attributionRes.value : null)
        setRecommendation(recommendationRes.status === 'fulfilled' ? recommendationRes.value : null)

        // If core data is missing, treat as error.
        const hasAny = quoteRes.status === 'fulfilled' || statsRes.status === 'fulfilled' || companyRes.status === 'fulfilled'
        if (!hasAny) setError('Engine unreachable')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || 'Failed to load asset')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [symbol])

  useEffect(() => {
    if (!symbol) return
    let cancelled = false
    setChartLoading(true)

    alphaFetch(`/api/history/${encodeURIComponent(symbol)}?range=${encodeURIComponent(chartRange)}&interval=1D`)
      .then((data) => {
        if (cancelled) return
        const list = transformHistory(data)
        setHistory(list)
        setPriceRange(computeRange(list))
      })
      .catch(() => {
        if (cancelled) return
        setHistory([])
        setPriceRange({ min: 0, max: 0, range: 0 })
      })
      .finally(() => {
        if (cancelled) return
        setChartLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [symbol, chartRange])

  const currentPrice = useMemo(() => {
    const p = quote?.price ?? quote?.last ?? stats?.price
    return Number.isFinite(Number(p)) ? Number(p) : null
  }, [quote, stats])
  const dayChangePct = useMemo(() => {
    const c = quote?.dailyChangePct ?? quote?.changePct ?? quote?.change ?? stats?.dayChangePct
    return Number.isFinite(Number(c)) ? Number(c) : null
  }, [quote, stats])

  const selectedStock = useMemo(() => {
    return {
      symbol,
      price: currentPrice ?? 0,
      change: dayChangePct ?? 0,
      freshness: 'delayed',
      ageMs: null,
    }
  }, [symbol, currentPrice, dayChangePct])

  const marketStatus = marketClock ? (marketClock.isOpen ? 'OPEN' : 'CLOSED') : (isMarketClosed() ? 'CLOSED' : 'OPEN')
  const nextOpen = formatETNextOpen(marketClock?.nextOpen)

  const toggleWatch = () => {
    const next = watched ? watchlist.filter((t) => t !== symbol) : [symbol, ...watchlist.filter((t) => t !== symbol)]
    setWatchlist(next)
    saveWatchlist(next)
  }

  const rec = recommendation?.recommendation ?? recommendation
  const recConfidence = normalizeConfidence(rec?.confidence)
  const recEntry = Array.isArray(rec?.entryZone) ? `${rec.entryZone[0]} – ${rec.entryZone[1]}` : rec?.entryZone
  const recThesis = Array.isArray(rec?.thesis) ? rec.thesis : typeof rec?.thesis === 'string' ? [rec.thesis] : []
  const recAvoidIf = Array.isArray(rec?.avoidIf) ? rec.avoidIf : typeof rec?.avoidIf === 'string' ? [rec.avoidIf] : []
  const recAsOf = fmtAsOf(rec?.asOf ?? rec?.as_of ?? recommendation?.asOf ?? recommendation?.as_of)

  const drivers = Array.isArray(attribution?.drivers)
    ? attribution.drivers
    : Array.isArray(attribution?.items)
      ? attribution.items
      : Array.isArray(attribution)
        ? attribution
        : []

  if (!symbol) {
    return (
      <div className="l-page l-container-sm">
        <h1 className="hero">Missing ticker</h1>
        <Link className="btn btn-sm btn-primary inline-block mt-3" to="/assets">Back to Assets</Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="l-page l-container-content">
        <div className="card card-pad-md">
          <div className="skeleton-block" style={{ height: 22, width: 220, marginBottom: 10 }} />
          <div className="skeleton-block" style={{ height: 14, width: 320, marginBottom: 18 }} />
          <div className="skeleton-block" style={{ height: 360, width: '100%' }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="l-page l-container-sm">
        <h1 className="hero">{symbol}</h1>
        <div className="alert alert-error mt-3">
          <div className="alert-title">Data unavailable</div>
          <div>{error}</div>
        </div>
        <div className="mt-3">
          <button className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>Retry</button>
          <Link className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} to="/assets">Back</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="l-page l-container-content">
      <header className="l-row mb-3" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow mb-1">{marketStatus} · {nextOpen ? `Next open ${nextOpen}` : ''}</div>
          <h1 className="hero mb-1" style={{ fontSize: 44 }}>
            {symbol}
            <span className="muted" style={{ fontWeight: 600 }}> · {company?.name ?? company?.companyName ?? '—'}</span>
          </h1>
          <div className="l-row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div className="text-xl font-700">{currentPrice != null ? fmtMoney(currentPrice) : '—'}</div>
            <div className={(dayChangePct ?? 0) >= 0 ? 'text-positive font-600' : 'text-negative font-600'}>
              {fmtPct(dayChangePct)}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {recAsOf ? `Model as of ${recAsOf}` : ' '}
            </div>
          </div>
        </div>

        <div className="stack-sm" style={{ minWidth: 220 }}>
          <button className="btn btn-sm btn-primary pressable" onClick={() => navigate(`/orders?ticker=${encodeURIComponent(symbol)}`)}>
            Trade
          </button>
          <button className="btn btn-sm btn-ghost pressable" onClick={toggleWatch}>
            {watched ? 'Watchlisted' : 'Add to Watchlist'}
          </button>
        </div>
      </header>

      <section className="l-grid-hero mb-3">
        <article className="card card-lg card-pad-md">
          <PriceChart
            selectedStock={selectedStock}
            priceHistory={history}
            priceRange={priceRange}
            chartRange={chartRange}
            onRangeChange={setChartRange}
            loading={chartLoading}
            compact={false}
            nextOpen={nextOpen}
          />
        </article>

        <article className="card card-lg card-pad-md">
          <div className="l-row mb-2" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>Key Stats</strong>
            <span className="muted" style={{ fontSize: 12 }}>{company?.sector ?? '—'} · {company?.industry ?? '—'}</span>
          </div>

          <div className="l-grid-3cols mt-2">
            <Stat label="Market Cap" value={stats?.marketCap ? fmtMoney(stats.marketCap) : '—'} />
            <Stat label="Avg Volume" value={stats?.avgVolume ? fmtNumber(stats.avgVolume) : '—'} />
            <Stat label="52W High" value={stats?.high52 ? fmtMoney(stats.high52) : '—'} />
            <Stat label="52W Low" value={stats?.low52 ? fmtMoney(stats.low52) : '—'} />
            <Stat
              label="Day Range"
              value={
                history.length
                  ? `${fmtMoney(history[history.length - 1].low)} – ${fmtMoney(history[history.length - 1].high)}`
                  : '—'
              }
            />
            <Stat label="Employees" value={company?.employees ? fmtNumber(company.employees) : '—'} />
          </div>
        </article>
      </section>

      <section className="l-grid-3lead mb-3">
        <article className="card card-pad-sm">
          <strong>Engine Signals</strong>
          <div className="data-rows mt-2">
            <div className="data-row-3 data-row-divider">
              <span className="muted">Regime</span>
              <span style={{ fontWeight: 700 }}>{regime?.regime ?? regime?.state ?? regime?.name ?? '—'}</span>
              <span className="muted text-right">{regime?.asOf ? fmtAsOf(regime.asOf) : ' '}</span>
            </div>
            <div className="data-row-3 data-row-divider">
              <span className="muted">Hit Rate</span>
              <span style={{ fontWeight: 700 }}>{accuracy?.hitRate != null ? fmtPct(accuracy.hitRate <= 1 ? accuracy.hitRate * 100 : accuracy.hitRate) : '—'}</span>
              <span className="muted text-right">{accuracy?.sampleCount != null ? `${fmtNumber(accuracy.sampleCount)} samples` : ' '}</span>
            </div>
            <div className="data-row-3 data-row-divider">
              <span className="muted">Residual Alpha</span>
              <span style={{ fontWeight: 700 }}>{accuracy?.residualAlpha != null ? fmtPct(accuracy.residualAlpha) : '—'}</span>
              <span className="muted text-right">{accuracy?.pFinal != null ? `pFinal ${accuracy.pFinal}` : ' '}</span>
            </div>
            {(consensus?.pFinal != null || consensus?.agreementBonus != null || consensus?.consensusStalenessMinutes != null) ? (
              <div className="data-row-3 data-row-divider">
                <span className="muted">Consensus</span>
                <span style={{ fontWeight: 700 }}>
                  {consensus?.pFinal != null ? `pFinal ${consensus.pFinal}` : '—'}
                </span>
                <span className="muted text-right">
                  {consensus?.agreementBonus != null ? `+${consensus.agreementBonus}` : consensus?.consensusStalenessMinutes != null ? `${consensus.consensusStalenessMinutes}m stale` : ' '}
                </span>
              </div>
            ) : null}
          </div>
        </article>

        <article className="card card-pad-sm">
          <strong>Why / Attribution</strong>
          {drivers.length ? (
            <div className="data-rows mt-2">
              {drivers.slice(0, 8).map((d, idx) => (
                <div key={idx} className="data-row-divider">
                  <div className="font-600">{d.category ?? d.group ?? '—'} · {d.direction ?? '—'} · {d.materiality ?? d.weight ?? '—'}</div>
                  <div className="muted">
                    {Array.isArray(d.tags) ? d.tags.join(', ') : d.tags ?? d.concepts ?? ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted mt-2">No attribution available.</div>
          )}
        </article>

        <article className="card card-pad-sm">
          <strong>Recommendation</strong>
          {rec?.ticker || rec?.symbol || rec ? (
            <div className="stack-sm mt-2">
              <div className="l-row" style={{ justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{rec?.action ?? '—'}</div>
                <div className="muted">{recConfidence != null ? `${recConfidence}%` : '—'}</div>
              </div>
              <div className="muted">{rec?.risk ?? '—'} · {rec?.horizon ?? '—'}</div>
              {recEntry ? (
                <div className="alert" style={{ padding: 12 }}>
                  <div className="alert-title">Entry Zone</div>
                  <div>{recEntry}</div>
                </div>
              ) : null}

              {recThesis.length ? (
                <div>
                  <div className="eyebrow mb-0">Thesis</div>
                  <ul className="list mt-2">
                    {recThesis.slice(0, 6).map((t, idx) => <li key={idx}>{t}</li>)}
                  </ul>
                </div>
              ) : null}

              {recAvoidIf.length ? (
                <div>
                  <div className="eyebrow mb-0">Avoid If</div>
                  <ul className="list mt-2">
                    {recAvoidIf.slice(0, 6).map((t, idx) => <li key={idx}>{t}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="muted mt-2">No recommendation available.</div>
          )}
        </article>
      </section>

      <section className="card card-pad-sm">
        <strong>Related Links</strong>
        <div className="data-rows mt-2">
          <div className="data-row-divider">
            <a className="btn btn-xs btn-ghost" href={company?.website ?? '#'} target="_blank" rel="noreferrer" style={{ pointerEvents: company?.website ? 'auto' : 'none', opacity: company?.website ? 1 : 0.55 }}>
              Company Website
            </a>
            <button className="btn btn-xs btn-ghost" style={{ marginLeft: 8 }} onClick={() => navigate('/assets')}>Back to Assets</button>
          </div>
        </div>
      </section>
    </div>
  )
}
