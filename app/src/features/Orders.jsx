import { useNavigate, useSearchParams } from 'react-router-dom'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from '../app/AppProvider'
import { get } from '../api/client.js'
import { getAvailableStocks } from '../services/marketData.js'
import { useOrderBootstrap } from '../hooks/useOrderBootstrap.js'
import { formatETNextOpen, isMarketClosed, getQuoteFreshness } from '../utils/market.js'

import SearchableDropdown  from './orders/components/SearchableDropdown.jsx'
import PriceChart          from './orders/components/PriceChart.jsx'
import AlphaPanel          from './orders/components/AlphaPanel.jsx'
import CompanyPanel        from './orders/components/CompanyPanel.jsx'
import TickerStatsPanel    from './orders/components/TickerStatsPanel.jsx'
import OrderTicket         from './orders/components/OrderTicket.jsx'
import OwnershipPanel      from './orders/components/OwnershipPanel.jsx'
import RecentExecutions    from './orders/components/RecentExecutions.jsx'

export default function Orders() {
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()
  const { dispatch }  = useApp()

  // ── Stock list ──────────────────────────────────────────────────────────────
  const [stocks,        setStocks]        = useState([])
  const [selectedStock, setSelectedStock] = useState(null)
  const [stocksLoading, setStocksLoading] = useState(true)
  const [chartRange,    setChartRange]    = useState('1Y')

  // ── Alpaca account (loaded once) ────────────────────────────────────────────
  const [alpacaAccount, setAlpacaAccount] = useState(null)
  const [marketClock,   setMarketClock]   = useState(null)

  // ── Bootstrap data (via hook — AbortController-based race protection) ───────
  const {
    bootstrapData, loading: bootstrapLoading, error: bootstrapError,
    priceHistory, priceRange, alpha, refresh: refreshBootstrap,
  } = useOrderBootstrap(selectedStock?.symbol, chartRange)

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
              price: quote.price || 0,
              change: quote.change || 0,
              volume: quote.volume || prev.volume,
              timestamp: quote.updatedAt,
              freshness: quote.freshness || 'unknown',
              ageMs: quote.ageMs || 0
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
  const bankBalance        = alpacaAccount?.buyingPower   ?? 0
  const bankConnected      = !!alpacaAccount
  const accountNumber      = alpacaAccount?.accountNumber
    ? `...${String(alpacaAccount.accountNumber).slice(-4)}` : '———'
  const buyingPower        = alpacaAccount?.buyingPower   ?? 0
  const dayTradesRemaining = alpacaAccount ? Math.max(0, 3 - (alpacaAccount.dayTradeCount ?? 0)) : '—'
  const patternDayTrader   = alpacaAccount?.patternDayTrader ?? false
  const marketStatus       = marketClock ? (marketClock.isOpen ? 'OPEN' : 'CLOSED') : '—'
  const nextOpen           = formatETNextOpen(marketClock?.nextOpen)

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
      if (clockRes.status   === 'fulfilled') setMarketClock(clockRes.value)
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

  return (
    <div className="page">
      <div className="container orders">

      {/* Account header */}
      <header className="orders-header">
        <div className="orders-header-left">
          <div>
            <div className="muted" style={{ fontSize: '12px' }}>Account</div>
            <div style={{ fontWeight: 600 }}>Individual {accountNumber}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '12px' }}>Available Funds</div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#0a7a47' }}>
              ${bankBalance.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '12px' }}>Buying Power</div>
            <div style={{ fontWeight: 600 }}>${buyingPower.toLocaleString()}</div>
          </div>
        </div>

        <div className="orders-header-right">
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: '12px' }}>Day Trades</div>
            <div style={{ fontWeight: 600, color: dayTradesRemaining > 0 ? '#0a7a47' : '#c0392b' }}>
              {dayTradesRemaining} left
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.25rem 0.75rem', borderRadius: '4px',
            background: patternDayTrader ? '#fff3cd' : '#f8f9fa',
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: bankConnected ? '#0a7a47' : '#c0392b' }} />
            <span style={{ fontSize: '12px' }}>{bankConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </header>

      {/* 2-column layout */}
      <div className="orders-grid">

        {/* ── Left column: stock selector + context panels ── */}
        <section className="orders-col">

          {/* Stock selector */}
          <article style={{ background: 'white', borderRadius: '8px', padding: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <SearchableDropdown
                  stocks={stocks}
                  selectedStock={selectedStock}
                  onSelect={setSelectedStock}
                  placeholder="Search symbols or companies..."
                />
              </div>
              <div style={{ marginLeft: '1rem', textAlign: 'right' }}>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>
                  ${displayStock ? displayStock.price.toFixed(2) : '0.00'}
                </div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: (displayStock?.change ?? 0) >= 0 ? '#0a7a47' : '#c0392b' }}>
                  {displayStock ? `${displayStock.change >= 0 ? '+' : ''}${displayStock.change}%` : '0.00%'}
                </div>
                {(() => {
                  if (quoteError && lastGoodQuote) {
                    const freshness = getQuoteFreshness(lastQuoteTime)
                    return (
                      <div style={{
                        fontSize: '11px',
                        color: '#e74c3c',
                        fontWeight: 500
                      }}>
                        {`Delayed • last updated ${freshness.ageSeconds}s ago`}
                      </div>
                    )
                  }
                  
                  if (quoteError) {
                    return (
                      <div style={{
                        fontSize: '11px',
                        color: '#e74c3c',
                        fontWeight: 500
                      }}>
                        Live quote unavailable
                      </div>
                    )
                  }
                  
                  if (displayStock?.timestamp) {
                    const freshness = getQuoteFreshness(new Date(displayStock.timestamp).getTime())
                    const color = freshness.state === 'live' ? '#0a7a47' :
                                 freshness.state === 'fresh' ? '#f39c12' : '#666'
                    
                    return (
                      <div style={{
                        fontSize: '11px',
                        color,
                        fontWeight: 500
                      }}>
                        {freshness.label}
                      </div>
                    )
                  }
                  
                  return null
                })()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '11px', color: '#666' }}>
              <div><span className="muted">Vol:</span> {displayStock?.volume ?? 'N/A'}</div>
              <div><span className="muted">Mkt Cap:</span> {selectedStock?.marketCap ?? 'N/A'}</div>
              <div style={{ color: marketStatus === 'CLOSED' ? '#c0392b' : '#0a7a47' }}>{marketStatus}</div>
            </div>

            {/* Bootstrap error banner — shown when the alpha engine is offline */}
            {bootstrapError && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: '0.75rem', padding: '0.5rem 0.75rem',
                background: '#fff3cd', borderRadius: '4px',
                fontSize: '11px', color: '#856404',
              }}>
                <span>{bootstrapError}. Showing cached prices.</span>
                <button
                  className="ghost pressable"
                  onClick={refreshBootstrap}
                  style={{ fontSize: '11px', padding: '0.15rem 0.5rem', marginLeft: '0.5rem' }}
                >
                  Retry
                </button>
              </div>
            )}
          </article>

          <CompanyPanel     selectedStock={selectedStock} bootstrapData={bootstrapData} loading={bootstrapLoading} />
          <TickerStatsPanel selectedStock={selectedStock} bootstrapData={bootstrapData} loading={bootstrapLoading} />
          <PriceChart
            selectedStock={selectedStock}
            priceHistory={priceHistory}
            priceRange={priceRange}
            chartRange={chartRange}
            onRangeChange={setChartRange}
            bootstrapData={bootstrapData}
            loading={bootstrapLoading}
            nextOpen={nextOpen}
          />
          <AlphaPanel       selectedStock={selectedStock} alpha={alpha} loading={bootstrapLoading} />
        </section>

        {/* ── Right column: order ticket + ownership + recent trades ── */}
        <section className="orders-col">
          <OrderTicket
            selectedStock={selectedStock}
            bankBalance={bankBalance}
            onSubmit={handleSubmit}
            bootstrapData={bootstrapData}
          />
          <OwnershipPanel   selectedStock={selectedStock} bootstrapData={bootstrapData} loading={bootstrapLoading} />
          <RecentExecutions selectedStock={selectedStock} bootstrapData={bootstrapData} />
        </section>
      </div>
      </div>
    </div>
  )
}
