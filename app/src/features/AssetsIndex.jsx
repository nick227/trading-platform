import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { alphaFetch } from '../api/services/alphaEngineService.js'

const RECENT_KEY = 'assets_recent_searches_v1'
const DEFAULT_MODE = 'balanced'

const TABLE_ROW_H = 44
const TABLE_HEAD_H = 40

const POPULAR_TICKERS = [
  { ticker: 'AAPL', name: 'Apple Inc.' },
  { ticker: 'MSFT', name: 'Microsoft Corp.' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.' },
  { ticker: 'AMZN', name: 'Amazon.com Inc.' },
  { ticker: 'TSLA', name: 'Tesla Inc.' },
  { ticker: 'NVDA', name: 'NVIDIA Corp.' },
  { ticker: 'META', name: 'Meta Platforms' },
  { ticker: 'BRK.B', name: 'Berkshire Hathaway' },
]

const SITE_PICKS = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', reason: 'Market Benchmark' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', reason: 'Tech Heavy' },
  { ticker: 'VTI', name: 'Vanguard Total Stock', reason: 'Total Market' },
  { ticker: 'BTC-USD', name: 'Bitcoin USD', reason: 'Crypto Leader' },
  { ticker: 'ETH-USD', name: 'Ethereum USD', reason: 'Smart Contracts' },
  { ticker: 'GLD', name: 'SPDR Gold Shares', reason: 'Safe Haven' },
  { ticker: 'VIX', name: 'CBOE Volatility Index', reason: 'Fear Gauge' },
  { ticker: 'DXY', name: 'US Dollar Index', reason: 'Dollar Strength' },
]

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

function parseEntryZone(value) {
  if (!value) return null
  if (Array.isArray(value) && value.length >= 2) {
    const low = Number(value[0])
    const high = Number(value[1])
    if (Number.isFinite(low) && Number.isFinite(high)) return { low, high }
  }

  const text = String(value)
  const range = text.match(/([-+]?\d*\.?\d+)\s*[–-]\s*([-+]?\d*\.?\d+)/)
  if (range) {
    const low = Number(range[1])
    const high = Number(range[2])
    if (Number.isFinite(low) && Number.isFinite(high)) return { low, high }
  }

  const single = text.match(/([-+]?\d*\.?\d+)/)
  if (single) {
    const num = Number(single[1])
    if (Number.isFinite(num)) return { low: num, high: num }
  }

  return null
}

function deriveRowPrice(row) {
  const raw =
    row?.price ??
    row?.last ??
    row?.currentPrice ??
    row?.current_price ??
    row?.entry ??
    row?.entryPrice ??
    row?.entry_price

  const num = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(num)) return num

  const zone = parseEntryZone(row?.entryZone ?? row?.entry_zone ?? row?.entry)
  if (zone) return (zone.low + zone.high) / 2

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

function VirtualRows({
  items,
  rowHeight = TABLE_ROW_H,
  height = 520,
  renderRow,
  renderHeader,
  headerHeight = 0,
  scrollerRef: externalScrollerRef = null
}) {
  const internalScrollerRef = useRef(null)
  const scrollerRef = externalScrollerRef ?? internalScrollerRef
  const [scrollTop, setScrollTop] = useState(0)

  const totalHeight = items.length * rowHeight
  const effectiveScrollTop = Math.max(0, scrollTop - headerHeight)
  const startIndex = Math.max(0, Math.floor(effectiveScrollTop / rowHeight) - 6)
  const endIndex = Math.min(items.length, Math.ceil((effectiveScrollTop + height) / rowHeight) + 6)
  const slice = items.slice(startIndex, endIndex)

  return (
    <div
      ref={scrollerRef}
      style={{ height, overflow: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {renderHeader ? (
        <div style={{ position: 'sticky', top: 0, zIndex: 3 }}>
          {renderHeader()}
        </div>
      ) : null}

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

function SkeletonRows({ count = 10, rowHeight = TABLE_ROW_H }) {
  return (
    <div className="data-rows">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="data-row-asset data-row-action" style={{ height: rowHeight }}>
          <div className="skeleton-block" style={{ height: 12, width: 60 }} />
          <div className="skeleton-block" style={{ height: 12, width: '70%' }} />
          <div className="skeleton-block" style={{ height: 12, width: 90, justifySelf: 'end' }} />
        </div>
      ))}
    </div>
  )
}

function SectionHeader({ title, right }) {
  return (
    <div className="l-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      {right ? <span className="muted" style={{ fontSize: 12 }}>{right}</span> : <span />}
    </div>
  )
}

function TickerRow3({
  ticker,
  to,
  onOpen,
  price,
  special,
  specialClassName = 'muted text-ellipsis-one-line',
  priceClassName = 'muted text-right text-nowrap',
  divider = true,
  className = '',
  style,
  ...rest
}) {
  const tkr = String(ticker ?? '').toUpperCase()
  const href = to ?? `/orders?ticker=${encodeURIComponent(tkr)}`
  const dividerClass = divider ? 'data-row-divider' : ''

  return (
    <Link
      className={`btn-reset data-row-asset data-row-ticker3 data-row-action pressable ${dividerClass} ${className}`.trim()}
      to={href}
      onClick={onOpen}
      style={style}
      {...rest}
    >
      <strong className="text-nowrap">{tkr || '—'}</strong>
      <span className={priceClassName}>{price ?? '—'}</span>
      <span className={specialClassName} style={{ minWidth: 0 }}>
        {special ?? ' '}
      </span>
    </Link>
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

  const [market, setMarket] = useState({ loading: true, error: null, data: null })
  const [topRankings, setTopRankings] = useState({ loading: true, error: null, data: null })
  const [movers, setMovers] = useState({ loading: true, error: null, data: null })
  const [recs, setRecs] = useState({ loading: true, error: null, data: {} })
  const [tickers, setTickers] = useState({ loading: false, error: null, data: [] })
  const [spotQuotes, setSpotQuotes] = useState({})

  const normalizeTicker = (symbol) => String(symbol ?? '').toUpperCase().trim()
  const tickerHref = (symbol) => {
    const tkr = normalizeTicker(symbol)
    return tkr ? `/orders?ticker=${encodeURIComponent(tkr)}` : '/orders'
  }

  const rememberTicker = (symbol) => {
    const tkr = normalizeTicker(symbol)
    if (!tkr) return null
    setRecent((prev) => {
      const nextRecent = [tkr, ...prev.filter((r) => r !== tkr)].slice(0, 8)
      saveRecentSearches(nextRecent)
      return nextRecent
    })
    return tkr
  }

  const openTicker = (symbol) => {
    const tkr = rememberTicker(symbol) ?? normalizeTicker(symbol)
    if (!tkr) return
    navigate(tickerHref(tkr))
  }

  const dataAsOf = useMemo(() => {
    const d = topRankings.data
    const asOf = d?.as_of ?? d?.asOf ?? d?.rankings?.[0]?.timestamp ?? null
    return fmtAsOf(asOf)
  }, [topRankings.data])

  const loadMarket = async () => {
    try {
      setMarket({ loading: true, error: null, data: null })
      const [quotesResponse, regime] = await Promise.all([
        alphaFetch('/api/quotes?symbols=SPY,QQQ,IWM'),
        alphaFetch('/api/regime/SPY')
      ])
      const quotesData = quotesResponse?.data || []
      const spy = quotesData.find(q => q.symbol === 'SPY') || null
      const qqq = quotesData.find(q => q.symbol === 'QQQ') || null
      const iwm = quotesData.find(q => q.symbol === 'IWM') || null
      setMarket({ loading: false, error: null, data: { spy, qqq, iwm, regime } })
    } catch (error) {
      setMarket({ loading: false, error: error.message || 'Failed to load market context', data: null })
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
      const caps = [2, 10, 100]
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
    let cancelled = false

    // Consolidate all startup fetches into single parallel batch
    const tickersToLoad = Array.from(
      new Set([...POPULAR_TICKERS, ...SITE_PICKS].map((item) => String(item.ticker).toUpperCase().trim()).filter(Boolean))
    )

    Promise.allSettled([
      loadMarket(),
      loadRankings(),
      loadMovers(),
      loadRecs(),
      alphaFetch(`/api/quotes?symbols=${tickersToLoad.join(',')}`)
    ])
      .then((results) => {
        if (cancelled) return

        // Handle quotes result
        const quotesResult = results[4]
        if (quotesResult.status === 'fulfilled') {
          const quotesData = quotesResult.value?.data || []
          const next = {}
          for (const quote of quotesData) {
            if (quote && !quote.error) {
              next[quote.symbol] = quote
            }
          }
          setSpotQuotes(next)
        } else {
          setSpotQuotes({})
        }
      })
      .catch(() => {
        if (cancelled) return
        setSpotQuotes({})
      })

    return () => {
      cancelled = true
    }
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
    return Array.isArray(rows) ? rows : []
  }, [topRankings.data])

  const moverRows = useMemo(() => {
    const rows = movers.data?.rankings
    return Array.isArray(rows) ? rows : []
  }, [movers.data])

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
    const q = String(debouncedQuery || '').trim()
    if (!q) return
    setTableIndex(0)
  }, [debouncedQuery])

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
    const desiredTop = TABLE_HEAD_H + tableIndex * TABLE_ROW_H
    const desiredBottom = desiredTop + TABLE_ROW_H
    const viewTop = tableScrollRef.current.scrollTop
    const viewBottom = viewTop + tableScrollRef.current.clientHeight
    if (desiredTop < viewTop) tableScrollRef.current.scrollTop = desiredTop
    else if (desiredBottom > viewBottom) {
      tableScrollRef.current.scrollTop = Math.max(0, desiredBottom - tableScrollRef.current.clientHeight)
    }
  }, [tableIndex])

  const recommendationCaps = [2, 10, 100]

  return (
    <div className="l-page">
      <div className="l-container" style={{ maxWidth: 1320 }}>
        <div className="l-stack-md" style={{ gap: 18 }}>
          <header className="l-row" style={{ alignItems: 'baseline' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>Assets</h1>
              <div className="muted" style={{ fontSize: 12 }}>
                {dataAsOf ? `Data as of ${dataAsOf}` : ' '}
              </div>
            </div>

          </header>

          <section className="l-grid-3">
            <article className="card card-pad-sm">
              <SectionHeader title="Popular Tickers" right="" />
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {POPULAR_TICKERS.map(({ ticker, name }) => (
                  <TickerRow3
                    key={ticker}
                    ticker={ticker}
                    to={tickerHref(ticker)}
                    onOpen={() => rememberTicker(ticker)}
                    price={fmtPrice(spotQuotes?.[ticker]?.price ?? spotQuotes?.[ticker]?.last)}
                    special={`${name} · Popular`}
                  />
                ))}
              </div>
            </article>

            <article className="card card-pad-sm">
              <SectionHeader title="Top Movers" right="" />
              {movers.loading ? (
                <div className="mt-2">
                  <SkeletonRows count={6} />
                </div>
              ) : movers.error ? (
                <div className="mt-2">
                  <div className="text-negative">{movers.error}</div>
                  <button className="btn btn-xs btn-ghost mt-2" onClick={loadMovers}>Retry</button>
                </div>
              ) : moverRows.length === 0 ? (
                <div className="muted mt-2">No movers data available.</div>
              ) : (
                <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {moverRows.slice(0, 8).map((r) => {
                    const tkr = r.ticker ?? r.symbol
                    const currentRank = r.currentRank ?? r.current_rank ?? r.rank ?? null
                    const priorRank = r.priorRank ?? r.prior_rank ?? r.prevRank ?? r.previousRank ?? r.previous_rank ?? null
                    const rankChange = r.rankChange ?? r.rank_change ?? (currentRank !== null && priorRank !== null ? priorRank - currentRank : null)
                    const price = r.price ?? r.last
                    const change = r.dailyChangePct ?? r.changePct ?? r.change
                    const changeLabel = change == null ? null : fmtPct(change)
                    const rankLabel =
                      currentRank !== null
                        ? `#${currentRank}${typeof rankChange === 'number' ? ` · ${rankChange > 0 ? '+' : ''}${rankChange}` : ''}`
                        : '—'

                    return (
                      <TickerRow3
                        key={tkr}
                        ticker={tkr}
                        to={tickerHref(tkr)}
                        onOpen={() => rememberTicker(tkr)}
                        price={fmtPrice(price)}
                        special={`${rankLabel}${changeLabel ? ` · ${changeLabel}` : ''}`}
                        specialClassName="muted text-right text-nowrap"
                      />
                    )
                  })}
                </div>
              )}
            </article>

            <article className="card card-pad-sm">
              <SectionHeader title="Site Picks" right="" />
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {SITE_PICKS.map(({ ticker, name, reason }) => (
                  <TickerRow3
                    key={ticker}
                    ticker={ticker}
                    to={tickerHref(ticker)}
                    onOpen={() => rememberTicker(ticker)}
                    price={fmtPrice(spotQuotes?.[ticker]?.price ?? spotQuotes?.[ticker]?.last)}
                    special={`${name} · ${reason}`}
                  />
                ))}
              </div>
            </article>
          </section>

          <section className="card card-pad-md">
            <SectionHeader
              title="Searchable Stock Table"
              right={
                tickers.loading
                  ? 'Searching…'
                  : tickers.error
                    ? tickers.error
                    : tickers.data.length
                      ? `${tickers.data.length} results`
                      : ''
              }
            />

            <div className="mt-2 l-row" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
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
                    borderRadius: '12px',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {recent.length > 0 ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: 12 }}>Recent:</span>
                  {recent.map((tkr) => (
                    <Link
                      key={tkr}
                      className="btn btn-xs btn-ghost pressable"
                      to={tickerHref(tkr)}
                      onClick={() => rememberTicker(tkr)}
                    >
                      {tkr}
                    </Link>
                  ))}
                </div>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}> </span>
              )}
            </div>

            <div className="mt-3" style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
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
                {String(debouncedQuery || '').trim() === '' ? (
                  <div style={{ padding: 12 }} className="muted">
                    ...
                  </div>
                ) : tickers.error ? (
                  <div style={{ padding: 12 }} className="text-negative">
                    {tickers.error}
                  </div>
                ) : tickers.data.length === 0 && !tickers.loading ? (
                  <div style={{ padding: 12 }} className="muted">
                    No matches.
                  </div>
                ) : tickers.loading ? (
                  <div style={{ padding: 10 }}>
                    <SkeletonRows count={10} />
                  </div>
                ) : (
                  <VirtualRows
                    items={sortedTickers}
                    height={520}
                    rowHeight={TABLE_ROW_H}
                    headerHeight={TABLE_HEAD_H}
                    scrollerRef={tableScrollRef}
                    renderHeader={() => (
                      <div
                        className="data-row-asset data-row-ticker3"
                        style={{
                          padding: '10px 12px',
                          background: '#fafafa',
                          borderBottom: '1px solid #eee',
                          fontSize: 12,
                          fontWeight: 800,
                          height: TABLE_HEAD_H,
                        }}
                      >
                        <button className="btn-reset" onClick={() => toggleSort('ticker')} style={{ textAlign: 'left' }}>
                          Ticker{tableSort.key === 'ticker' ? (tableSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </button>
                        <button className="btn-reset text-right" onClick={() => toggleSort('price')}>
                          Price{tableSort.key === 'price' ? (tableSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </button>
                        <button className="btn-reset" onClick={() => toggleSort('name')} style={{ textAlign: 'left' }}>
                          Details{tableSort.key === 'name' ? (tableSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </button>
                      </div>
                    )}
                    renderRow={(row, idx) => {
                      const tkr = String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '').toUpperCase()
                      const name = row?.name ?? row?.companyName ?? row?.company_name ?? '—'
                      const price = row?.price ?? row?.last
                      const change = row?.dailyChangePct ?? row?.changePct ?? row?.change
                      const selected = idx === tableIndex
                      const changeClass = (change ?? 0) >= 0 ? 'text-positive' : 'text-negative'
                      const special = (
                        <>
                          <span className={changeClass}>{fmtPct(change)}</span>
                          <span className="muted"> · {name}</span>
                        </>
                      )
                      return (
                        <TickerRow3
                          ticker={tkr}
                          to={tickerHref(tkr)}
                          onOpen={() => rememberTicker(tkr)}
                          onMouseEnter={() => setTableIndex(idx)}
                          aria-selected={selected}
                          className={selected ? 'is-selected' : ''}
                          divider={false}
                          style={{
                            height: TABLE_ROW_H,
                            borderBottom: '1px solid #f0f0f0',
                          }}
                          price={fmtPrice(price)}
                          special={special}
                          specialClassName="text-ellipsis-one-line"
                        />
                      )
                    }}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="l-grid-3lead">
            <article className="card card-pad-sm">
              <SectionHeader title="Market Context" right="" />
              {market.loading ? (
                <div className="muted mt-2">Loading…</div>
              ) : market.error ? (
                <div className="mt-2">
                  <div className="text-negative">{market.error}</div>
                  <button className="btn btn-xs btn-ghost mt-2" onClick={loadMarket}>Retry</button>
                </div>
              ) : (
                <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {[
                    ['SPY', market.data?.spy],
                    ['QQQ', market.data?.qqq],
                    ['IWM', market.data?.iwm]
                  ].map(([label, q]) => (
                    <TickerRow3
                      key={label}
                      ticker={label}
                      to={tickerHref(label)}
                      onOpen={() => rememberTicker(label)}
                      price={fmtPrice(q?.price ?? q?.last)}
                      special={fmtPct(q?.dailyChangePct ?? q?.changePct ?? q?.change)}
                      specialClassName="muted text-right text-nowrap"
                    />
                  ))}

                  <div className="mt-2">
                    <div className="eyebrow mb-0">Regime</div>
                    <div style={{ fontWeight: 700 }}>
                      {market.data?.regime?.regime ?? market.data?.regime?.name ?? market.data?.regime?.state ?? '—'}
                    </div>
                  </div>
                </div>
              )}
            </article>

            <article className="card card-pad-sm">
              <SectionHeader title="Ranked Opportunities" right="" />
              {topRankings.loading ? (
                <div className="mt-2">
                  <SkeletonRows count={8} />
                </div>
              ) : topRankings.error ? (
                <div className="mt-2">
                  <div className="text-negative">{topRankings.error}</div>
                  <button className="btn btn-xs btn-ghost mt-2" onClick={loadRankings}>Retry</button>
                </div>
              ) : rankedRows.length === 0 ? (
                <div className="muted mt-2">No ranked opportunities.</div>
              ) : (
                <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {rankedRows.slice(0, 12).map((r) => {
                    const tkr = r.ticker ?? r.symbol
                    const conviction = r.conviction ?? r.confidence
                    const score = Number(r.score)
                    const conf = Number(conviction)
                    const edge =
                      (Number.isFinite(score) ? score : 0) *
                      (Number.isFinite(conf) ? conf : 1)
                    return (
                      <TickerRow3
                        key={tkr}
                        ticker={tkr}
                        to={tickerHref(tkr)}
                        onOpen={() => rememberTicker(tkr)}
                        price={fmtPrice(r.price)}
                        special={`Edge ${fmtScore(edge)} · ${fmtPct(r.dailyChangePct)}`}
                        specialClassName="muted text-right text-nowrap"
                      />
                    )
                  })}
                </div>
              )}
            </article>

            <article className="card card-pad-sm">
              <SectionHeader title="Ranking Movers" right="" />
              {movers.loading ? (
                <div className="mt-2">
                  <SkeletonRows count={8} />
                </div>
              ) : movers.error ? (
                <div className="mt-2">
                  <div className="text-negative">{movers.error}</div>
                  <button className="btn btn-xs btn-ghost mt-2" onClick={loadMovers}>Retry</button>
                </div>
              ) : moverRows.length === 0 ? (
                <div className="muted mt-2">No movers.</div>
              ) : (
                <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {moverRows.slice(0, 12).map((r) => {
                    const tkr = r.ticker ?? r.symbol
                    const currentRank = r.currentRank ?? r.current_rank ?? r.rank ?? null
                    const priorRank = r.priorRank ?? r.prior_rank ?? r.prevRank ?? r.previousRank ?? r.previous_rank ?? null
                    const rankChange = r.rankChange ?? r.rank_change ?? (currentRank !== null && priorRank !== null ? priorRank - currentRank : null)

                    return (
                      <TickerRow3
                        key={tkr}
                        ticker={tkr}
                        to={tickerHref(tkr)}
                        onOpen={() => rememberTicker(tkr)}
                        price={fmtPrice(r.price)}
                        special={`${currentRank !== null ? `#${currentRank}` : '—'}${
                          typeof rankChange === 'number' ? ` · ${rankChange > 0 ? '+' : ''}${rankChange}` : ''
                        } · ${fmtPct(r.dailyChangePct)}`}
                        specialClassName="muted text-right text-nowrap"
                      />
                    )
                  })}
                </div>
              )}
            </article>
          </section>

          <section>
            <div className="l-row mb-2" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ fontSize: 14 }}>Price-Capped Recommendations</strong>
              <span className="muted" style={{ fontSize: 12 }}>Mode: {DEFAULT_MODE}</span>
            </div>

            {recs.loading ? (
              <div className="card card-pad-sm">
                <SkeletonRows count={8} />
              </div>
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
                        <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                          {rows.slice(0, 10).map((r) => {
                            const tkr = r.ticker ?? r.symbol
                            const conf = normalizeConfidence(r.confidence)
                            const entry = Array.isArray(r.entryZone) ? `${r.entryZone[0]} – ${r.entryZone[1]}` : r.entryZone
                            const price = deriveRowPrice(r)
                            return (
                              <TickerRow3
                                key={tkr}
                                ticker={tkr}
                                to={tickerHref(tkr)}
                                onOpen={() => rememberTicker(tkr)}
                                price={fmtPrice(price)}
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
          </section>
        </div>
      </div>
    </div>
  )
}
