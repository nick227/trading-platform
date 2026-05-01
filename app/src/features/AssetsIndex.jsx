import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { alphaFetch } from '../api/services/alphaEngineService.js'
import PageSkeleton from '../components/PageSkeleton.jsx'
import ErrorState from '../components/ErrorState.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import usePageData from '../hooks/usePageData.js'
import {
  TABLE_ROW_H,
  TABLE_HEAD_H,
  POPULAR_TICKERS,
  SITE_PICKS,
} from './assets/constants.js'
import {
  loadRecentSearches,
  saveRecentSearches,
  fmtPct,
  fmtPrice,
  deriveRowPrice,
  useDebounced,
  normalizeSymbol
} from './assets/utils.js'
import { VirtualRows, SkeletonRows, TickerRow3 } from './assets/components.jsx'

export default function AssetsIndex() {
  const navigate = useNavigate()

  const [recent, setRecent] = useState(() => loadRecentSearches())
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 120)

  // Sync recent searches across tabs
  useEffect(() => {
    const handleStorageChange = () => setRecent(loadRecentSearches())
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const [tableSort, setTableSort] = useState({ key: 'ticker', dir: 'asc' })
  const [tableIndex, setTableIndex] = useState(-1)
  const tableScrollRef = useRef(null)

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

  const fetchAssetsPage = useCallback(async () => {
    const tickersToLoad = Array.from(
      new Set([
        ...POPULAR_TICKERS,
        ...SITE_PICKS,
      ].map((item) => String(item.ticker).toUpperCase().trim()).filter(Boolean))
    )
    const result = await alphaFetch(`/api/quotes?symbols=${tickersToLoad.join(',')}`)
    const quotesData = Array.isArray(result) ? result : result?.data || []
    const next = {}
    for (const quote of quotesData) {
      if (quote && !quote.error) next[normalizeSymbol(quote.symbol)] = quote
    }
    setSpotQuotes(next)
    return true
  }, [])

  const { loading: pageLoading, error: pageError, retry } = usePageData({
    key: 'assets-page',
    fetcher: fetchAssetsPage
  })

  const searchRequestIdRef = useRef(0)

  useEffect(() => {
    const q = String(debouncedQuery || '').trim()
    if (!q) {
      setTickers({ loading: false, error: null, data: [] })
      return
    }
    const requestId = ++searchRequestIdRef.current
    setTickers((prev) => ({ ...prev, loading: true, error: null }))
    alphaFetch(`/api/tickers?q=${encodeURIComponent(q)}`)
      .then((data) => {
        if (requestId !== searchRequestIdRef.current) return
        const list = Array.isArray(data) ? data : Array.isArray(data?.tickers) ? data.tickers : []
        setTickers({ loading: false, error: null, data: list })
      })
      .catch((error) => {
        if (requestId !== searchRequestIdRef.current) return
        setTickers({ loading: false, error: error.message || 'Search failed', data: [] })
      })
  }, [debouncedQuery])

  const enrichedTickers = useMemo(() => {
    return tickers.data.map(r => ({ ...r, _price: deriveRowPrice(r) }))
  }, [tickers.data])

  const sortedTickers = useMemo(() => {
    const list = enrichedTickers
    if (!Array.isArray(list) || list.length === 0) return []
    const { key, dir } = tableSort
    const sign = dir === 'desc' ? -1 : 1
    const getValue = (row) => {
      if (key === 'ticker') return String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '')
      if (key === 'name') return String(row?.name ?? row?.companyName ?? row?.company_name ?? '')
      if (key === 'price') return Number(row._price ?? NaN)
      if (key === 'change') return Number(row?.dailyChangePct ?? row?.changePct ?? row?.change ?? NaN)
      return ''
    }
    return list.slice().sort((a, b) => {
      const av = getValue(a)
      const bv = getValue(b)
      if (typeof av === 'number' && typeof bv === 'number') {
        const aNum = Number.isFinite(av) ? av : -Infinity
        const bNum = Number.isFinite(bv) ? bv : -Infinity
        return sign * (aNum - bNum)
      }
      return sign * String(av).localeCompare(String(bv))
    })
  }, [enrichedTickers, tableSort])

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
    if (!sortedTickers.length) { setTableIndex(-1); return }
    if (tableIndex < 0) return
    if (tableIndex >= sortedTickers.length) setTableIndex(sortedTickers.length - 1)
  }, [sortedTickers.length, tableIndex])

  useEffect(() => {
    if (tableIndex < 0 || !tableScrollRef.current) return
    const desiredTop = TABLE_HEAD_H + tableIndex * TABLE_ROW_H
    const desiredBottom = desiredTop + TABLE_ROW_H
    const viewTop = tableScrollRef.current.scrollTop
    const viewBottom = viewTop + tableScrollRef.current.clientHeight
    if (desiredTop < viewTop) tableScrollRef.current.scrollTop = desiredTop
    else if (desiredBottom > viewBottom) {
      tableScrollRef.current.scrollTop = Math.max(0, desiredBottom - tableScrollRef.current.clientHeight)
    }
  }, [tableIndex])

  if (pageLoading) return <PageSkeleton />
  if (pageError) return <ErrorState onRetry={retry} message={pageError?.message || 'Failed to load assets'} />

  return (
    <div className="l-page">
      <div className="l-container" style={{ maxWidth: 1320 }}>
        <div className="l-stack-md" style={{ gap: 18 }}>
          <header className="l-row" style={{ alignItems: 'baseline' }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>Assets</h1>
          </header>

          {/* Popular Tickers + Site Picks */}
          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <article className="card card-pad-sm">
              <SectionHeader title="Popular Tickers" right="" />
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {POPULAR_TICKERS.map(({ ticker, name }) => {
                  const sym = normalizeSymbol(ticker)
                  const quote = spotQuotes?.[sym]
                  return (
                    <TickerRow3
                      key={`popular-${ticker}`}
                      ticker={ticker}
                      to={tickerHref(ticker)}
                      onOpen={() => rememberTicker(ticker)}
                      price={fmtPrice(quote?.price ?? quote?.last)}
                      special={`${name} · Popular`}
                    />
                  )
                })}
              </div>
            </article>

            <article className="card card-pad-sm">
              <SectionHeader title="Site Picks" right="" />
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {SITE_PICKS.map(({ ticker, name, reason }) => {
                  const sym = normalizeSymbol(ticker)
                  const quote = spotQuotes?.[sym]
                  return (
                    <TickerRow3
                      key={`sitepick-${ticker}`}
                      ticker={ticker}
                      to={tickerHref(ticker)}
                      onOpen={() => rememberTicker(ticker)}
                      price={fmtPrice(quote?.price ?? quote?.last)}
                      special={`${name} · ${reason}`}
                    />
                  )
                })}
              </div>
            </article>
          </section>

          {/* Searchable Stock Table */}
          <section className="card card-pad-md">
            {(() => {
              let searchStatus = ''
              if (tickers.loading) searchStatus = 'Searching…'
              else if (tickers.error) searchStatus = tickers.error
              else if (tickers.data.length) searchStatus = `${tickers.data.length} results`
              return <SectionHeader title="Searchable Stock Table" right={searchStatus} />
            })()}

            <div className="mt-2 l-row" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <input
                  value={query}
                  placeholder="Ticker or company…"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (sortedTickers.length > 0) {
                        const firstResult = sortedTickers[0]
                        const tkr = String(firstResult?.ticker ?? firstResult?.symbol ?? firstResult?.tkr ?? '').toUpperCase()
                        openTicker(tkr)
                      } else {
                        openTicker(query)
                      }
                    }
                  }}
                  style={{ width: '100%', padding: '0.75rem', border: '1px solid #e9ecef', borderRadius: 12, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {recent.length > 0 ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: 12 }}>Recent:</span>
                  {recent.map((tkr) => (
                    <Link
                      key={`recent-${tkr}`}
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
                    setTableIndex((i) => i >= sortedTickers.length - 1 ? 0 : i + 1)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setTableIndex((i) => i < 0 ? sortedTickers.length - 1 : Math.max(0, i - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (tableIndex < 0) return
                    const row = sortedTickers[tableIndex]
                    const tkr = String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '').toUpperCase()
                    openTicker(tkr)
                  }
                }}
                style={{ outline: 'none' }}
              >
                {String(debouncedQuery || '').trim() === '' ? (
                  <div style={{ padding: 12 }} className="muted">...</div>
                ) : tickers.error ? (
                  <div style={{ padding: 12 }} className="text-negative">{tickers.error}</div>
                ) : tickers.data.length === 0 && !tickers.loading ? (
                  <div style={{ padding: 12 }} className="muted">No matches.</div>
                ) : tickers.loading ? (
                  <div style={{ padding: 10 }}><SkeletonRows count={10} /></div>
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
                        style={{ padding: '10px 12px', background: '#fafafa', borderBottom: '1px solid #eee', fontSize: 12, fontWeight: 800, height: TABLE_HEAD_H }}
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
                      const price = row._price ?? deriveRowPrice(row)
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
                          style={{ height: TABLE_ROW_H, borderBottom: '1px solid #f0f0f0' }}
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

        </div>
      </div>
    </div>
  )
}
