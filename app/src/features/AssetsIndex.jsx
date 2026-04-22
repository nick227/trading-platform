import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { alphaFetch } from '../api/services/alphaEngineService.js'

const RECENT_KEY = 'assets_recent_searches_v1'
const DEFAULT_MODE = 'balanced'

function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : []
  } catch {
    return []
  }
}

function saveRecentSearches(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)))
  } catch {
    // ignore
  }
}

function fmtPct(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

function fmtPrice(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  return `$${num.toFixed(2)}`
}

function fmtScore(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toFixed(2)
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

function useDebounced(value, delayMs) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

function VirtualRows({ items, rowHeight = 44, height = 520, renderRow, scrollerRef: externalScrollerRef = null }) {
  const internalScrollerRef = useRef(null)
  const scrollerRef = externalScrollerRef ?? internalScrollerRef
  const [scrollTop, setScrollTop] = useState(0)

  const totalHeight = items.length * rowHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 6)
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + 6)
  const slice = items.slice(startIndex, endIndex)

  return (
    <div
      ref={scrollerRef}
      style={{ height, overflow: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {slice.map((item, i) => {
          const idx = startIndex + i
          return (
            <div
              key={item?.ticker || item?.symbol || item?.id || idx}
              style={{
                position: 'absolute',
                top: idx * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight
              }}
            >
              {renderRow(item, idx)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModelRunPill({ topRankings }) {
  const runStatus = topRankings?.runStatus ?? topRankings?.run_status ?? null
  const runQuality = topRankings?.runQuality ?? topRankings?.run_quality ?? null
  const rankedUnderDegradedRun = topRankings?.rankedUnderDegradedRun ?? topRankings?.ranked_under_degraded_run ?? null
  const asOf = topRankings?.as_of ?? topRankings?.asOf ?? topRankings?.rankings?.[0]?.timestamp ?? null

  const statusText = runStatus ? String(runStatus) : 'UNKNOWN'
  const qualityText = typeof runQuality === 'number' ? runQuality.toFixed(2) : '—'
  const asOfText = fmtAsOf(asOf) ?? '—'
  const degraded = (statusText && statusText !== 'HEALTHY') || rankedUnderDegradedRun === true

  return (
    <div
      className="btn btn-xs btn-ghost"
      style={{
        display: 'inline-flex',
        gap: 8,
        alignItems: 'center',
        border: `1px solid ${degraded ? '#c0392b' : '#ddd'}`,
        background: degraded ? 'rgba(192,57,43,0.06)' : 'white'
      }}
      title={`As of ${asOfText}`}
    >
      <span style={{ fontWeight: 700 }}>Model</span>
      <span className={degraded ? 'text-negative' : 'muted'}>{statusText}</span>
      <span className="muted">Q {qualityText}</span>
    </div>
  )
}

function SkeletonRows({ count = 10, rowHeight = 44 }) {
  return (
    <div className="data-rows mt-2">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="data-row-3 data-row-action" style={{ height: rowHeight }}>
          <div className="skeleton-block" style={{ height: 12, width: 60 }} />
          <div className="skeleton-block" style={{ height: 12, width: '70%' }} />
          <div className="skeleton-block" style={{ height: 12, width: 90, justifySelf: 'end' }} />
        </div>
      ))}
    </div>
  )
}

export default function AssetsIndex() {
  const navigate = useNavigate()

  const [recent, setRecent] = useState(() => loadRecentSearches())
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 250)
  const [tableSort, setTableSort] = useState({ key: 'ticker', dir: 'asc' })
  const [tableIndex, setTableIndex] = useState(-1)
  const tableScrollRef = useRef(null)

  const [header, setHeader] = useState({ loading: true, error: null, data: null })
  const [topRankings, setTopRankings] = useState({ loading: true, error: null, data: null })
  const [movers, setMovers] = useState({ loading: true, error: null, data: null })
  const [recs, setRecs] = useState({ loading: true, error: null, data: {} })
  const [tickers, setTickers] = useState({ loading: false, error: null, data: [] })

  const degraded = useMemo(() => {
    const d = topRankings.data
    if (!d) return false
    const runStatus = d.runStatus ?? d.run_status
    const rankedUnderDegradedRun = d.rankedUnderDegradedRun ?? d.ranked_under_degraded_run
    return (runStatus && runStatus !== 'HEALTHY') || rankedUnderDegradedRun === true
  }, [topRankings.data])

  const dataAsOf = useMemo(() => {
    const d = topRankings.data
    const asOf = d?.as_of ?? d?.asOf ?? d?.rankings?.[0]?.timestamp ?? null
    return fmtAsOf(asOf)
  }, [topRankings.data])

  const openTicker = (symbol) => {
    const tkr = String(symbol || '').toUpperCase().trim()
    if (!tkr) return
    const nextRecent = [tkr, ...recent.filter((r) => r !== tkr)].slice(0, 8)
    setRecent(nextRecent)
    saveRecentSearches(nextRecent)
    navigate(`/assets/${tkr}`)
  }

  const loadHeader = async () => {
    try {
      setHeader({ loading: true, error: null, data: null })
      const [spy, qqq, iwm, regime] = await Promise.all([
        alphaFetch('/api/quote/SPY'),
        alphaFetch('/api/quote/QQQ'),
        alphaFetch('/api/quote/IWM'),
        alphaFetch('/api/regime/SPY')
      ])
      setHeader({ loading: false, error: null, data: { spy, qqq, iwm, regime } })
    } catch (error) {
      setHeader({ loading: false, error: error.message || 'Failed to load market context', data: null })
    }
  }

  const loadRankings = async () => {
    try {
      setTopRankings({ loading: true, error: null, data: null })
      const data = await alphaFetch('/rankings/top?limit=25&maxFragility=0.40')
      setTopRankings({ loading: false, error: null, data })
    } catch (error) {
      setTopRankings({ loading: false, error: error.message || 'Failed to load ranked opportunities', data: null })
    }
  }

  const loadMovers = async () => {
    try {
      setMovers({ loading: true, error: null, data: null })
      const data = await alphaFetch('/rankings/movers?limit=25')
      setMovers({ loading: false, error: null, data })
    } catch (error) {
      setMovers({ loading: false, error: error.message || 'Failed to load ranking movers', data: null })
    }
  }

  const loadRecs = async () => {
    try {
      setRecs({ loading: true, error: null, data: {} })
      const caps = [10, 25, 50]
      const results = await Promise.all(
        caps.map((cap) =>
          alphaFetch(`/recommendations/under/${cap}?mode=${DEFAULT_MODE}&limit=25`).then((data) => [cap, data])
        )
      )
      const next = {}
      for (const [cap, data] of results) next[cap] = data
      setRecs({ loading: false, error: null, data: next })
    } catch (error) {
      setRecs({ loading: false, error: error.message || 'Failed to load price-capped recommendations', data: {} })
    }
  }

  useEffect(() => {
    loadHeader()
    loadRankings()
    loadMovers()
    loadRecs()
  }, [])

  useEffect(() => {
    const q = String(debouncedQuery || '').trim()
    if (!q) {
      setTickers({ loading: false, error: null, data: [] })
      return
    }

    let cancelled = false
    setTickers((prev) => ({ ...prev, loading: true, error: null }))

    alphaFetch(`/api/tickers?q=${encodeURIComponent(q)}`)
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data) ? data : Array.isArray(data?.tickers) ? data.tickers : []
        setTickers({ loading: false, error: null, data: list })
      })
      .catch((error) => {
        if (cancelled) return
        setTickers({ loading: false, error: error.message || 'Search failed', data: [] })
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  const rankedRows = useMemo(() => {
    const rows = topRankings.data?.rankings
    if (!Array.isArray(rows)) return []
    return rows
  }, [topRankings.data])

  const moverRows = useMemo(() => {
    const rows = movers.data?.rankings
    if (!Array.isArray(rows)) return []
    return rows
  }, [movers.data])

  const recommendationCaps = [10, 25, 50]
  const sortedTickers = useMemo(() => {
    const list = tickers.data
    if (!Array.isArray(list) || list.length === 0) return []

    const { key, dir } = tableSort
    const sign = dir === 'desc' ? -1 : 1

    const getValue = (row) => {
      if (key === 'ticker') return String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '')
      if (key === 'name') return String(row?.name ?? row?.companyName ?? row?.company_name ?? '')
      if (key === 'price') return Number(row?.price ?? row?.last ?? NaN)
      if (key === 'change') return Number(row?.dailyChangePct ?? row?.changePct ?? row?.change ?? NaN)
      return ''
    }

    return [...list].sort((a, b) => {
      const av = getValue(a)
      const bv = getValue(b)

      if (typeof av === 'number' && typeof bv === 'number') {
        const aNum = Number.isFinite(av) ? av : -Infinity
        const bNum = Number.isFinite(bv) ? bv : -Infinity
        return sign * (aNum - bNum)
      }

      return sign * String(av).localeCompare(String(bv))
    })
  }, [tickers.data, tableSort])

  const toggleSort = (key) => {
    setTableSort((prev) => {
      if (prev.key !== key) return { key, dir: key === 'name' ? 'asc' : 'desc' }
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  useEffect(() => {
    if (!sortedTickers.length) {
      setTableIndex(-1)
      return
    }
    if (tableIndex < 0) return
    if (tableIndex >= sortedTickers.length) setTableIndex(sortedTickers.length - 1)
  }, [sortedTickers.length, tableIndex])

  useEffect(() => {
    if (tableIndex < 0) return
    if (!tableScrollRef.current) return
    const rowHeight = 44
    const desiredTop = tableIndex * rowHeight
    const desiredBottom = desiredTop + rowHeight
    const viewTop = tableScrollRef.current.scrollTop
    const viewBottom = viewTop + tableScrollRef.current.clientHeight
    if (desiredTop < viewTop) tableScrollRef.current.scrollTop = desiredTop
    else if (desiredBottom > viewBottom) tableScrollRef.current.scrollTop = Math.max(0, desiredBottom - tableScrollRef.current.clientHeight)
  }, [tableIndex])

  return (
    <div className="l-page l-container-content">
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--page-bg, #f6f6f6)',
          paddingTop: 16,
          paddingBottom: 10
        }}
      >
        <div className="l-row" style={{ gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div className="eyebrow mb-1">Search</div>
            <input
              value={query}
              placeholder="Ticker or company…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openTicker(query)
              }}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #e9ecef',
                borderRadius: '10px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <ModelRunPill topRankings={topRankings.data} />
            <div className="muted" style={{ fontSize: 12 }}>
              {dataAsOf ? `Data as of ${dataAsOf}` : ' '}
            </div>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="l-row mt-2" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 12 }}>Recent:</span>
            {recent.map((tkr) => (
              <button key={tkr} className="btn btn-xs btn-ghost" onClick={() => openTicker(tkr)}>
                {tkr}
              </button>
            ))}
          </div>
        )}

        {degraded && (
          <div className="card card-pad-sm mt-2" style={{ borderColor: '#c0392b', background: 'rgba(192,57,43,0.06)' }}>
            <strong className="text-negative">Degraded run</strong>
            <div className="muted">Rankings may be stale or partially covered.</div>
          </div>
        )}
      </div>

      <section className="l-grid-3lead mb-3">
        <article className="card card-pad-sm">
          <strong>Market Context</strong>
          {header.loading ? (
            <div className="muted mt-2">Loading…</div>
          ) : header.error ? (
            <div className="mt-2">
              <div className="text-negative">{header.error}</div>
              <button className="btn btn-xs btn-ghost mt-2" onClick={loadHeader}>Retry</button>
            </div>
          ) : (
            <div className="data-rows mt-2">
              {[
                ['SPY', header.data?.spy],
                ['QQQ', header.data?.qqq],
                ['IWM', header.data?.iwm]
              ].map(([label, q]) => (
                <div key={label} className="data-row-3 data-row-divider">
                  <strong>{label}</strong>
                  <span>{fmtPrice(q?.price ?? q?.last)}</span>
                  <span className="muted text-right">{fmtPct(q?.dailyChangePct ?? q?.changePct ?? q?.change)}</span>
                </div>
              ))}

              <div className="mt-2">
                <div className="eyebrow mb-0">Regime</div>
                <div style={{ fontWeight: 700 }}>
                  {header.data?.regime?.regime ?? header.data?.regime?.name ?? header.data?.regime?.state ?? '—'}
                </div>
              </div>
            </div>
          )}
        </article>

        <article className="card card-pad-sm">
          <strong>Ranked Opportunities</strong>
          {topRankings.loading ? (
            <SkeletonRows count={8} />
          ) : topRankings.error ? (
            <div className="mt-2">
              <div className="text-negative">{topRankings.error}</div>
              <button className="btn btn-xs btn-ghost mt-2" onClick={loadRankings}>Retry</button>
            </div>
          ) : rankedRows.length === 0 ? (
            <div className="muted mt-2">No ranked opportunities.</div>
          ) : (
            <div className="data-rows mt-2">
              {rankedRows.slice(0, 12).map((r) => {
                const tkr = r.ticker ?? r.symbol
                const conviction = r.conviction ?? r.confidence
                return (
                  <button
                    key={tkr}
                    className="btn-reset data-row-3 data-row-divider data-row-action pressable"
                    onClick={() => openTicker(tkr)}
                  >
                    <strong>{tkr}</strong>
                    <span className="muted">{fmtScore(r.score)} · C {fmtScore(conviction)}</span>
                    <span className="text-right">
                      <span className="muted" style={{ marginRight: 10 }}>{fmtPrice(r.price)}</span>
                      <span className={(r.dailyChangePct ?? 0) >= 0 ? 'text-positive' : 'text-negative'}>
                        {fmtPct(r.dailyChangePct)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </article>

        <article className="card card-pad-sm">
          <strong>Ranking Movers</strong>
          {movers.loading ? (
            <SkeletonRows count={8} />
          ) : movers.error ? (
            <div className="mt-2">
              <div className="text-negative">{movers.error}</div>
              <button className="btn btn-xs btn-ghost mt-2" onClick={loadMovers}>Retry</button>
            </div>
          ) : moverRows.length === 0 ? (
            <div className="muted mt-2">No movers.</div>
          ) : (
            <div className="data-rows mt-2">
              {moverRows.slice(0, 12).map((r) => {
                const tkr = r.ticker ?? r.symbol
                const currentRank = r.currentRank ?? r.current_rank ?? r.rank ?? null
                const priorRank = r.priorRank ?? r.prior_rank ?? r.prevRank ?? r.previousRank ?? r.previous_rank ?? null
                const rankChange = r.rankChange ?? r.rank_change ?? (currentRank !== null && priorRank !== null ? priorRank - currentRank : null)
                return (
                  <button
                    key={tkr}
                    className="btn-reset data-row-3 data-row-divider data-row-action pressable"
                    onClick={() => openTicker(tkr)}
                  >
                    <strong>{tkr}</strong>
                    <span className="muted">
                      {currentRank !== null ? `#${currentRank}` : '—'}
                      {typeof rankChange === 'number' ? ` · ${rankChange > 0 ? '+' : ''}${rankChange}` : ''}
                    </span>
                    <span className="text-right">
                      <span className="muted" style={{ marginRight: 10 }}>{fmtPrice(r.price)}</span>
                      <span className={(r.dailyChangePct ?? 0) >= 0 ? 'text-positive' : 'text-negative'}>
                        {fmtPct(r.dailyChangePct)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </article>
      </section>

      <section className="mb-3">
        <div className="l-row mb-2" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="hero" style={{ fontSize: 20, margin: 0 }}>Price-Capped Recommendations</h2>
          <span className="muted" style={{ fontSize: 12 }}>Mode: {DEFAULT_MODE}</span>
        </div>

        {recs.loading ? (
          <div className="card card-pad-sm"><SkeletonRows count={8} /></div>
        ) : recs.error ? (
          <div className="card card-pad-sm">
            <div className="text-negative">{recs.error}</div>
            <button className="btn btn-xs btn-ghost mt-2" onClick={loadRecs}>Retry</button>
          </div>
        ) : (
          <div className="l-grid-3">
            {recommendationCaps.map((cap) => {
              const payload = recs.data?.[cap]
              const rows = payload?.recommendations ?? payload?.items ?? []
              const asOf = fmtAsOf(payload?.asOf ?? payload?.as_of ?? rows?.[0]?.asOf ?? rows?.[0]?.as_of)
              return (
                <article key={cap} className="card card-pad-sm">
                  <div className="l-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong>Under ${cap}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>{asOf ? `As of ${asOf}` : ' '}</span>
                  </div>
                  {Array.isArray(rows) && rows.length > 0 ? (
                    <div className="data-rows mt-2">
                      {rows.slice(0, 10).map((r) => {
                        const tkr = r.ticker ?? r.symbol
                        const conf = normalizeConfidence(r.confidence)
                        const entry = Array.isArray(r.entryZone) ? `${r.entryZone[0]} – ${r.entryZone[1]}` : r.entryZone
                        return (
                          <button
                            key={tkr}
                            className="btn-reset data-row-3 data-row-divider data-row-action pressable"
                            onClick={() => openTicker(tkr)}
                          >
                            <strong>{tkr}</strong>
                            <span className="muted">{r.action ?? '—'}{conf !== null ? ` · ${conf}%` : ''}</span>
                            <span className="muted text-right">{entry ? `Entry ${entry}` : ' '}</span>
                          </button>
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
      </section>

      <section className="card card-pad-sm">
        <div className="l-row mb-2" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong>Searchable Stock Table</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {tickers.loading ? 'Searching…' : tickers.error ? tickers.error : tickers.data.length ? `${tickers.data.length} results` : ' '}
          </span>
        </div>

        {String(debouncedQuery || '').trim() === '' ? (
          <div className="muted">Type to search tickers (server-side).</div>
        ) : tickers.error ? (
          <div>
            <div className="text-negative">{tickers.error}</div>
          </div>
        ) : tickers.data.length === 0 && !tickers.loading ? (
          <div className="muted">No matches.</div>
        ) : (
          <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
            <div
              className="data-row-3"
              style={{
                padding: '10px 12px',
                background: '#fafafa',
                borderBottom: '1px solid #eee',
                fontSize: 12,
                fontWeight: 700
              }}
            >
              <button className="btn-reset" onClick={() => toggleSort('ticker')} style={{ textAlign: 'left' }}>
                Ticker{tableSort.key === 'ticker' ? (tableSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
              <button className="btn-reset" onClick={() => toggleSort('name')} style={{ textAlign: 'left' }}>
                Name{tableSort.key === 'name' ? (tableSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
              <button className="btn-reset text-right" onClick={() => toggleSort('price')}>
                Price{tableSort.key === 'price' ? (tableSort.dir === 'asc' ? ' ↑' : ' ↓') : ''} · Day
              </button>
            </div>

            {tickers.loading ? (
              <SkeletonRows count={12} />
            ) : (
              <div
                tabIndex={0}
                role="listbox"
                aria-label="Ticker search results"
                onFocus={() => {
                  if (tableIndex === -1 && sortedTickers.length) setTableIndex(0)
                }}
                onKeyDown={(e) => {
                  if (!sortedTickers.length) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setTableIndex((i) => Math.min(sortedTickers.length - 1, Math.max(0, i) + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setTableIndex((i) => Math.max(0, (i < 0 ? 0 : i) - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    const row = sortedTickers[Math.max(0, tableIndex)]
                    const tkr = String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '').toUpperCase()
                    openTicker(tkr)
                  }
                }}
                style={{ outline: 'none' }}
              >
                <VirtualRows
                  items={sortedTickers}
                  height={520}
                  rowHeight={44}
                  scrollerRef={tableScrollRef}
                  renderRow={(row, idx) => {
                    const tkr = String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '').toUpperCase()
                    const name = row?.name ?? row?.companyName ?? row?.company_name ?? '—'
                    const price = row?.price ?? row?.last
                    const change = row?.dailyChangePct ?? row?.changePct ?? row?.change
                    const selected = idx === tableIndex
                    return (
                      <button
                        className={`btn-reset data-row-3 data-row-action pressable ${selected ? 'is-selected' : ''}`}
                        onClick={() => openTicker(tkr)}
                        onMouseEnter={() => setTableIndex(idx)}
                        aria-selected={selected}
                      >
                        <strong>{tkr || '—'}</strong>
                        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}
                        </span>
                        <span className="text-right">
                          <span className="muted" style={{ marginRight: 10 }}>{fmtPrice(price)}</span>
                          <span className={(change ?? 0) >= 0 ? 'text-positive' : 'text-negative'}>
                            {fmtPct(change)}
                          </span>
                        </span>
                      </button>
                    )
                  }}
                />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
