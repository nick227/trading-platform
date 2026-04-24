import { useNavigate, useSearchParams } from 'react-router-dom'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from '../app/AppProvider'
import { get } from '../api/client.js'
import { getAvailableStocks } from '../services/marketData.js'
import { useOrderBootstrap } from '../hooks/useOrderBootstrap.js'
import { useChartHistory } from '../hooks/useChartHistory.js'
import { formatETNextOpen, isMarketClosed, getQuoteFreshness } from '../utils/market.js'

import SearchableDropdown from './orders/components/SearchableDropdown.jsx'
import PriceChart from './orders/components/PriceChart.jsx'
import AlphaPanel from './orders/components/AlphaPanel.jsx'
import CompanyPanel from './orders/components/CompanyPanel.jsx'
import TickerStatsPanel from './orders/components/TickerStatsPanel.jsx'
import OrderTicket from './orders/components/OrderTicket.jsx'
import OwnershipPanel from './orders/components/OwnershipPanel.jsx'
import RecentExecutions from './orders/components/RecentExecutions.jsx'
import SchedulingAndBotsPanel from './orders/components/SchedulingAndBotsPanel.jsx'
import TopTemplatesPanel from './orders/components/TopTemplatesPanel.jsx'
import ResearchPanel from './orders/components/ResearchPanel.jsx'
import RecommendationPanel from './orders/components/RecommendationPanel.jsx'
import EngineSignalsPanel from './orders/components/EngineSignalsPanel.jsx'
import PendingOrdersWidget from '../components/PendingOrdersWidget.jsx'
import TimezoneClock from '../components/TimezoneClock.jsx'
import { useAuth } from '../app/AuthProvider'

export default function Orders() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { dispatch } = useApp()

  // ── Stock list ──────────────────────────────────────────────────────────────
  const [stocks, setStocks] = useState([])
  const [selectedStock, setSelectedStock] = useState(null)
  const [stocksLoading, setStocksLoading] = useState(true)
  const [chartRange, setChartRange] = useState('1Y')

  // ── Alpaca account (loaded once) ────────────────────────────────────────────
  const [alpacaAccount, setAlpacaAccount] = useState(null)
  const [marketClock, setMarketClock] = useState(null)

  // ── Bootstrap data (via hook — AbortController-based race protection) ───────
  const {
    bootstrapData, loading: bootstrapLoading, error: bootstrapError,
    refresh: refreshBootstrap,
  } = useOrderBootstrap(selectedStock?.symbol, '1Y', setSelectedStock)

  const {
    history: priceHistory,
    priceRange,
    loading: chartLoading,
  } = useChartHistory(selectedStock?.symbol, chartRange, '1D')

  // ── Live quote auto-refresh (visibility-aware polling with refs) ────────────────────────
  const [liveQuote, setLiveQuote] = useState(null)
  const [quoteError, setQuoteError] = useState(null)
  const [lastGoodQuote, setLastGoodQuote] = useState(null)
  const [lastQuoteTime, setLastQuoteTime] = useState(null)

  // ── Memoized selected stock display model ───────────────────────────────────
  const displayStock = useMemo(() => {
    if (!selectedStock) return null

    // Base stock data
    const base = {
      ...selectedStock,
      price: selectedStock.price || 0,
      change: selectedStock.change || 0,
      volume: selectedStock.volume || 0
    }

    // Overlay live quote if available
    if (liveQuote && !quoteError) {
      return {
        ...base,
        price: liveQuote.price || base.price,
        change: liveQuote.change || base.change,
        volume: liveQuote.volume || base.volume,
        timestamp: liveQuote.updatedAt,
        freshness: liveQuote.freshness || 'unknown',
        ageMs: liveQuote.ageMs || 0
      }
    }

    // Use last good quote if available during errors
    if (quoteError && lastGoodQuote) {
      return {
        ...base,
        price: lastGoodQuote.price || base.price,
        change: lastGoodQuote.change || base.change,
        volume: lastGoodQuote.volume || base.volume,
        timestamp: lastGoodQuote.updatedAt,
        freshness: 'delayed',
        ageMs: Date.now() - lastQuoteTime
      }
    }

    return base
  }, [selectedStock, liveQuote, quoteError, lastGoodQuote, lastQuoteTime])

  // Use refs to avoid effect restarts when visibility/focus changes
  const visibilityRef = useRef(true)
  const focusRef = useRef(true)

  // Track page visibility and window focus (update refs, don't restart effect)
  useEffect(() => {
    const handleVisibilityChange = () => {
      visibilityRef.current = !document.hidden
    }

    const handleFocus = () => { focusRef.current = true }
    const handleBlur = () => { focusRef.current = false }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // Determine polling interval based on visibility state and market hours (reads refs)
  const getPollingInterval = () => {
    if (!focusRef.current) return null // Pause when window is blurred
    if (!visibilityRef.current) return 20000 // 20 seconds when tab is hidden
    if (isMarketClosed()) return 60000 // 60 seconds when market is closed
    return 3000 // 3 seconds when market is open and tab is visible
  }

  useEffect(() => {
    if (!selectedStock?.symbol) {
      setLiveQuote(null)
      setQuoteError(null)
      return
    }

    const controller = new AbortController()
    let timeoutId = null

    const fetchQuote = async () => {
      try {
        const response = await fetch(`/api/market/quote/${selectedStock.symbol}`)
        if (!response.ok) throw new Error('Quote fetch failed')
        const quote = await response.json()
        if (!controller.signal.aborted) {
          setLiveQuote(quote)
          setLastGoodQuote(quote)
          setLastQuoteTime(Date.now())
          setQuoteError(null)
          // Update selectedStock with live price
          setSelectedStock(prev => {
            if (!prev || prev.symbol !== selectedStock.symbol) return prev
            return {
              ...prev,
              price: Number.isFinite(quote?.price) ? quote.price : prev.price,
              change: Number.isFinite(quote?.change) ? quote.change : prev.change,
              volume: Number.isFinite(quote?.volume) ? quote.volume : prev.volume,
              timestamp: quote?.updatedAt ?? prev.timestamp,
              freshness: quote?.freshness || prev.freshness || 'unknown',
              ageMs: Number.isFinite(quote?.ageMs) ? quote.ageMs : (prev.ageMs || 0)
            }
          })
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setQuoteError('Live quote unavailable')
          console.warn('Live quote fetch failed:', err)
        }
      }

      // Schedule next fetch based on visibility state
      const interval = getPollingInterval()
      if (interval && !controller.signal.aborted) {
        timeoutId = setTimeout(fetchQuote, interval)
      }
    }

    // Initial fetch
    fetchQuote()

    return () => {
      controller.abort()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [selectedStock?.symbol, setSelectedStock])

  // ── Derived account values ──────────────────────────────────────────────────
  const bankBalance = alpacaAccount?.buyingPower ?? 0
  const bankConnected = !!alpacaAccount
  const accountNumber = alpacaAccount?.accountNumber
    ? `...${String(alpacaAccount.accountNumber).slice(-4)}` : '———'
  const buyingPower = alpacaAccount?.buyingPower ?? 0
  const patternDayTrader = alpacaAccount?.patternDayTrader ?? false
  const marketStatus = marketClock ? (marketClock.isOpen ? 'OPEN' : 'CLOSED') : '—'
  const nextOpen = formatETNextOpen(marketClock?.nextOpen)

  // ── Load stock list ─────────────────────────────────────────────────────────
  useEffect(() => {
    setStocksLoading(true)
    getAvailableStocks()
      .then(data => {
        setStocks(data)
        if (data.length > 0 && !selectedStock) setSelectedStock(data[0])
      })
      .catch(err => console.error('Failed to load stocks:', err))
      .finally(() => setStocksLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load alpaca account + market clock ──────────────────────────────────────
  useEffect(() => {
    Promise.allSettled([
      get('/alpaca/account'),
      get('/alpaca/market-clock'),
    ]).then(([accountRes, clockRes]) => {
      if (accountRes.status === 'fulfilled') setAlpacaAccount(accountRes.value)
      if (clockRes.status === 'fulfilled') setMarketClock(clockRes.value)
    })
  }, [])

  // ── Pre-select stock from URL ?ticker= param ────────────────────────────────
  useEffect(() => {
    const ticker = searchParams.get('ticker')
    if (!ticker || !stocks.length) return
    const match = stocks.find(s => s.symbol === ticker)
    if (match) setSelectedStock(match)
  }, [searchParams, stocks])

  // ── Navigate to order confirmation ──────────────────────────────────────────
  const handleSubmit = (orderData) => {
    dispatch({ type: 'SELECT_ORDER', payload: orderData.id })
    navigate('/orders/confirm', { state: { order: orderData } })
  }
  const { user } = useAuth()

  return (
    <div className="l-page">
      <div className="container orders">

        {/* Account header */}
        <header className="orders-header">
          <div className="orders-header-left meta-kpis">
            <div className="meta-kpi">
              <div className="meta-label">Account</div>
              <div className="meta-value">Individual {accountNumber}</div>
            </div>
            <div className="meta-kpi">
              <div className="meta-label">Available Funds</div>
              <div className="meta-value-lg text-positive">${bankBalance.toLocaleString()}</div>
            </div>
            <div className="meta-kpi">
              <div className="meta-label">Buying Power</div>
              <div className="meta-value">${buyingPower.toLocaleString()}</div>
            </div>
          </div>

          <div className="orders-header-right">
            <div className="row text-sm">
              {bankConnected ? '' : 'Connecting...'}
              <TimezoneClock />
            </div>
          </div>
        </header>

        {/* 2-column layout */}
        <div className="orders-grid">

          {/* ── Left column: stock selector + context panels ── */}
          <section className="orders-col">

            {/* Stock selector */}
            <article className="card card-pad-sm">
              <div className="panel-header">
                <div className="flex-1">
                  <SearchableDropdown
                    stocks={stocks}
                    selectedStock={selectedStock}
                    onSelect={setSelectedStock}
                    placeholder="Search symbols or companies..."
                  />
                </div>
                <div className="text-right">
                  <div className="quote">
                    <div className="quote-price">
                      ${displayStock ? displayStock.price.toFixed(2) : '0.00'}
                    </div>
                    <div className={`quote-change ${(displayStock?.change ?? 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {displayStock && Number.isFinite(displayStock.change)
                        ? `${displayStock.change >= 0 ? '+' : ''}${displayStock.change.toFixed(2)}%`
                        : '—'}
                    </div>
                  </div>
                  {(() => {
                    if (quoteError && lastGoodQuote) {
                      const freshness = getQuoteFreshness(lastQuoteTime)
                      return (
                        <div className="text-xs font-500 text-negative">
                          {`Delayed • last updated ${freshness.ageSeconds}s ago`}
                        </div>
                      )
                    }

                    if (quoteError) {
                      return (
                        <div className="text-xs font-500 text-negative">
                          Live quote unavailable
                        </div>
                      )
                    }

                    if (displayStock?.timestamp) {
                      const freshness = getQuoteFreshness(new Date(displayStock.timestamp).getTime())
                      const freshnessClass =
                        freshness.state === 'live'
                          ? 'text-positive'
                          : freshness.state === 'fresh'
                            ? 'text-warning'
                            : 'text-muted'

                      return (
                        <div className={`text-xs font-500 ${freshnessClass}`}>
                          {freshness.label}
                        </div>
                      )
                    }

                    return null
                  })()}
                </div>
              </div>
              <div className="quote-meta">
                <div><span className="muted">Vol:</span> {displayStock?.volume ?? 'N/A'}</div>
                <div><span className="muted">Mkt Cap:</span> {selectedStock?.marketCap ?? 'N/A'}</div>
                <div className={marketStatus === 'CLOSED' ? 'text-negative' : 'text-positive'}>{marketStatus}</div>
              </div>

              {/* Bootstrap error banner — shown when the alpha engine is offline */}
              {bootstrapError && (
                <div className="alert alert-warn mt-3 row text-xs">
                  <span>{bootstrapError}. Showing cached prices.</span>
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={refreshBootstrap}
                  >
                    Retry
                  </button>
                </div>
              )}
            </article>

            <CompanyPanel selectedStock={selectedStock} bootstrapData={bootstrapData} loading={bootstrapLoading} />
            <TickerStatsPanel selectedStock={selectedStock} bootstrapData={bootstrapData} loading={bootstrapLoading} />
            <PriceChart
              selectedStock={selectedStock}
              priceHistory={priceHistory}
              priceRange={priceRange}
              chartRange={chartRange}
              onRangeChange={setChartRange}
              bootstrapData={bootstrapData}
              loading={chartLoading}
              nextOpen={nextOpen}
            />
            <AlphaPanel selectedStock={selectedStock} explainability={bootstrapData?.alpha} loading={bootstrapLoading} />

            {/* Ported from Asset.jsx: templates + research + recommendation + engine signals */}
            <div className="mt-3">
              <TopTemplatesPanel selectedStock={selectedStock} user={user} />
            </div>
            <div className="mt-3">
              <EngineSignalsPanel selectedStock={selectedStock} />
            </div>
          </section>

          {/* ── Right column: order ticket + ownership + recent trades ── */}
          <section className="orders-col">
            <OrderTicket
              selectedStock={selectedStock}
              bankBalance={bankBalance}
              onSubmit={handleSubmit}
              bootstrapData={bootstrapData}
            />
            <OwnershipPanel selectedStock={selectedStock} bootstrapData={bootstrapData} loading={bootstrapLoading} />
            <SchedulingAndBotsPanel
              selectedStock={selectedStock}
            />
            {user && <PendingOrdersWidget />}
            <RecentExecutions selectedStock={selectedStock} bootstrapData={bootstrapData} />

            <div className="mt-3">
              <ResearchPanel selectedStock={selectedStock} />
            </div>
            <div className="mt-3">
              <RecommendationPanel selectedStock={selectedStock} bootstrapData={bootstrapData} loading={bootstrapLoading} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
