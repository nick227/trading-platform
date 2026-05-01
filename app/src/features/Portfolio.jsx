import { useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useApp } from '../app/AppProvider.jsx'
import { useAuth } from '../app/AuthProvider.jsx'
import { get, post } from '../api/client.js'
import pricesService from '../api/services/pricesService.js'
import StatCard from '../components/StatCard.jsx'
import PageSkeleton from '../components/PageSkeleton.jsx'
import ErrorState from '../components/ErrorState.jsx'
import usePageData from '../hooks/usePageData.js'
import PortfolioHeader from './portfolio/PortfolioHeader.jsx'
import HoldingsTable from './portfolio/HoldingsTable.jsx'
import ActivityFeed from './portfolio/ActivityFeed.jsx'
import PriceChart from './orders/components/PriceChart.jsx'
import { loadWatchlist, removeFromWatchlist, saveWatchlist } from '../utils/watchlist.js'
import { formatCurrency, formatPercent } from '../utils/format.js'

export default function Portfolio() {
  const { user, brokerStatus } = useAuth()
  const navigate = useNavigate()
  const { state } = useApp()
  const { holdings, stats, recentActivity, executions, loading, error, refetch } = usePortfolio()
  const [alpacaAccount, setAlpacaAccount] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [snapshots, setSnapshots] = useState([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(true)
  const [chartRange, setChartRange] = useState('1M')
  const [useExecutionsFallback, setUseExecutionsFallback] = useState(false)
  const [reconcileStatus, setReconcileStatus] = useState(null)
  const [reconciling, setReconciling] = useState(false)
  const fetchPortfolioPage = useCallback(async () => {
    const [, account, sync] = await Promise.all([
      refetch(),
      get('/alpaca/account').catch(() => null),
      get('/account/reconcile-status').catch(() => null)
    ])
    setAlpacaAccount(account)
    setReconcileStatus(sync)
    return true
  }, [refetch])
  const { loading: pageLoading, error: pageError, retry } = usePageData({
    key: 'portfolio-page',
    fetcher: fetchPortfolioPage
  })
  const cash = Number(alpacaAccount?.cash)
  const equity = Number(alpacaAccount?.equity)
  const equityMinusCash = Number.isFinite(equity) && Number.isFinite(cash) ? equity - cash : null
  const modeledPortfolioValue = Number.isFinite(stats?.totalValue) ? stats.totalValue : null
  const portfolioValue = Number.isFinite(equityMinusCash) ? equityMinusCash : modeledPortfolioValue
  const concentrationBaseValue = Number.isFinite(modeledPortfolioValue) && modeledPortfolioValue > 0 ? modeledPortfolioValue : portfolioValue
  const buyingPower = Number(alpacaAccount?.buyingPower)
  const investedAmount = Number.isFinite(stats?.investedAmount) ? stats.investedAmount : null
  const brokerConnected = Boolean(brokerStatus?.connected)

  const largestPosition = useMemo(() => {
    const list = Array.isArray(holdings) ? holdings : []
    if (!list.length) return null
    let maxHolding = list[0]
    for (const holding of list) {
      const current = Number(holding?.marketValue)
      const max = Number(maxHolding?.marketValue)
      if (Number.isFinite(current) && (!Number.isFinite(max) || current > max)) maxHolding = holding
    }
    const value = Number(maxHolding?.marketValue)
    if (!Number.isFinite(value)) return null
    const ticker = String(maxHolding?.ticker ?? '').trim()
    const weightPct = Number.isFinite(concentrationBaseValue) && concentrationBaseValue > 0 ? (value / concentrationBaseValue) * 100 : null
    return { ticker, value, weightPct }
  }, [holdings, concentrationBaseValue])

  const lastTradeAge = useMemo(() => {
    const list = Array.isArray(executions) ? executions : []
    const latest = list.reduce((bestTs, execution) => {
      const ts = Date.parse(execution?.createdAt ?? '')
      if (!Number.isFinite(ts)) return bestTs
      return ts > bestTs ? ts : bestTs
    }, Number.NEGATIVE_INFINITY)
    if (!Number.isFinite(latest)) return null
    const ageMs = nowMs - latest
    if (ageMs < 60_000) return `${Math.max(0, Math.floor(ageMs / 1000))}s ago`
    if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`
    if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`
    return `${Math.floor(ageMs / 86_400_000)}d ago`
  }, [executions, nowMs])

  const pnlSnapshot = useMemo(() => {
    const totalReturn = Number.isFinite(stats?.totalReturn) ? stats.totalReturn : null
    const totalReturnPct = Number.isFinite(stats?.totalReturnPct) ? stats.totalReturnPct : null

    const valueTone = totalReturn == null ? undefined : totalReturn > 0 ? 'positive' : totalReturn < 0 ? 'negative' : undefined
    const subtitle =
      totalReturnPct == null ? 'Total return' : `${formatPercent(totalReturnPct, { showSign: true, decimals: 1 })} total return`

    return {
      value: totalReturn == null ? 'â€”' : formatCurrency(totalReturn, 0),
      subtitle,
      valueTone,
    }
  }, [stats?.totalReturn, stats?.totalReturnPct])

  const biggestMoves = useMemo(() => {
    const list = Array.isArray(holdings) ? holdings : []
    const rows = list
      .map((h) => {
        const marketValue = Number(h?.marketValue)
        const buyIn = Number(h?.buyIn)
        const pnl = marketValue - buyIn
        if (!Number.isFinite(pnl)) return null
        const ticker = String(h?.ticker ?? '').trim()
        if (!ticker) return null
        return { ticker, pnl }
      })
      .filter(Boolean)

    if (!rows.length) return { profit: null, loss: null }

    let profit = rows[0]
    let loss = rows[0]
    for (const row of rows) {
      if (row.pnl > profit.pnl) profit = row
      if (row.pnl < loss.pnl) loss = row
    }

    return { profit, loss }
  }, [holdings])

  const [watchlist, setWatchlist] = useState(() => loadWatchlist())
  const watchlistCount = watchlist.length
  const watchlistView = useMemo(() => watchlist.slice(0, 12), [watchlist])
  const watchlistViewKey = useMemo(() => watchlistView.join('|'), [watchlistView])
  const [watchlistPriceMap, setWatchlistPriceMap] = useState(null)

  const { priceHistory, priceRange, availableRanges } = useMemo(() => {
    if (!snapshots.length) {
      // Fallback: build P/L history from executions
      const execList = Array.isArray(executions) ? executions : []
      if (execList.length === 0) {
        // No executions either, use current equity as single point
        const currentEquity = Number.isFinite(equity) ? equity : null
        if (currentEquity) {
          const now = new Date()
          const history = [{
            ts: now.getTime(),
            date: now.toISOString().slice(0, 10),
            close: currentEquity,
            price: currentEquity,
          }]
          return { priceHistory: history, priceRange: { min: currentEquity, max: currentEquity, range: 1 }, availableRanges: ['MAX'] }
        }
        return { priceHistory: [], priceRange: { min: 0, max: 0, range: 0 }, availableRanges: [] }
      }

      // Build cumulative P/L from executions
      const sortedExecs = [...execList]
        .filter(e => e.filledAt)
        .sort((a, b) => new Date(a.filledAt) - new Date(b.filledAt))

      let cumulativePnL = 0
      const history = sortedExecs.map(exec => {
        cumulativePnL += Number(exec.pnl || 0)
        return {
          ts: new Date(exec.filledAt).getTime(),
          date: new Date(exec.filledAt).toISOString().slice(0, 10),
          close: cumulativePnL,
          price: cumulativePnL,
        }
      })

      // Add current point if equity is available
      const currentEquity = Number.isFinite(equity) ? equity : null
      if (currentEquity && history.length > 0) {
        const now = new Date()
        history.push({
          ts: now.getTime(),
          date: now.toISOString().slice(0, 10),
          close: currentEquity,
          price: currentEquity,
        })
      }

      if (history.length === 0) {
        return { priceHistory: [], priceRange: { min: 0, max: 0, range: 0 }, availableRanges: [] }
      }

      const values = history.map(h => h.close)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const range = max - min

      // Calculate available ranges based on data span
      const firstTs = history[0]?.ts
      const lastTs = history[history.length - 1]?.ts
      const spanDays = firstTs && lastTs ? (lastTs - firstTs) / (1000 * 60 * 60 * 24) : 0
      
      const ranges = ['MAX']
      if (spanDays >= 365) ranges.push('1Y', '5Y')
      if (spanDays >= 90) ranges.push('3M')
      if (spanDays >= 30) ranges.push('1M')
      if (spanDays >= 7) ranges.push('1W')
      if (spanDays >= 1) ranges.push('1D')

      return { priceHistory: history, priceRange: { min, max, range: range || 1 }, availableRanges: ranges }
    }

    const sorted = [...snapshots].sort((a, b) => 
      new Date(a.snapshotDate) - new Date(b.snapshotDate)
    )

    const history = sorted.map(snap => ({
      ts: new Date(snap.snapshotDate).getTime(),
      date: new Date(snap.snapshotDate).toISOString().slice(0, 10),
      close: Number(snap.equity),
      price: Number(snap.equity),
    }))

    const values = history.map(h => h.close)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min

    // Calculate available ranges based on data span
    const firstTs = history[0]?.ts
    const lastTs = history[history.length - 1]?.ts
    const spanDays = firstTs && lastTs ? (lastTs - firstTs) / (1000 * 60 * 60 * 24) : 0
    
    const ranges = ['MAX']
    if (spanDays >= 365) ranges.push('1Y', '5Y')
    if (spanDays >= 90) ranges.push('3M')
    if (spanDays >= 30) ranges.push('1M')
    if (spanDays >= 7) ranges.push('1W')
    if (spanDays >= 1) ranges.push('1D')

    return { priceHistory: history, priceRange: { min, max, range: range || 1 }, availableRanges: ranges }
  }, [snapshots, equity, executions])

  const selectedStock = useMemo(() => ({
    symbol: 'Portfolio',
    price: priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].close : 0,
    freshness: 'stale',
  }), [priceHistory])

  useEffect(() => {
    const timerId = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timerId)
  }, [])

  useEffect(() => {
    const fetchSnapshots = async () => {
      try {
        setSnapshotsLoading(true)
        const data = await get('/performance/daily-snapshots')
        setSnapshots(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('Failed to fetch performance snapshots:', err)
        setSnapshots([])
      } finally {
        setSnapshotsLoading(false)
      }
    }

    fetchSnapshots()
  }, [])

  useEffect(() => {
    if (state.lastFilledAt) refetch()
  }, [state.lastFilledAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refresh = () => setWatchlist(loadWatchlist())
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener('watchlist:updated', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('watchlist:updated', refresh)
    }
  }, [])

  useEffect(() => {
    if (!watchlistCount) {
      return
    }

    let cancelled = false
    pricesService
      .getPriceMap()
      .then((map) => {
        if (cancelled) return
        setWatchlistPriceMap(map)
      })
      .catch(() => {
        // ignore
      })

    return () => {
      cancelled = true
    }
  }, [watchlistCount, watchlistViewKey])

  const handleReconcileNow = async () => {
    try {
      setReconciling(true)
      await post('/account/reconcile', {})
      const status = await get('/account/reconcile-status').catch(() => null)
      setReconcileStatus(status)
      await refetch()
    } finally {
      setReconciling(false)
    }
  }

  const mismatchSummary = useMemo(() => {
    const symbols = Array.isArray(reconcileStatus?.mismatchSymbols)
      ? reconcileStatus.mismatchSymbols.filter(Boolean)
      : []
    const count = Number(reconcileStatus?.mismatchCount ?? symbols.length ?? 0)
    const preview = symbols.slice(0, 2).join(', ')
    const suffix = count > 2 ? '…' : ''
    return {
      count,
      label: preview ? `${preview}${suffix}` : null
    }
  }, [reconcileStatus])

  if (pageLoading || loading) return <PageSkeleton />
  if (pageError || error) return <ErrorState onRetry={retry} message={`Failed to load portfolio: ${pageError?.message || error}`} />

  return (
    <div className="l-page">
      <div className="container l-stack-lg">
        <header className="mb-0">
          <PortfolioHeader user={user} stats={stats} onRefresh={refetch} />
        </header>

        {!brokerConnected && (
          <section className="alert alert-warn">
            <div className="alert-title">Broker Not Connected</div>
            <div className="text-sm">Connect Alpaca in Profile → Broker to enable live broker balances and trading actions.</div>
          </section>
        )}

        {brokerConnected && reconcileStatus?.inSync === false && (
          <section className="alert alert-warn">
            <div className="alert-title">Portfolio May Be Out Of Sync</div>
            <div className="text-sm">
              Out of sync ({mismatchSummary.count} positions{mismatchSummary.label ? `: ${mismatchSummary.label}` : ''}). Source of truth: executions are from DB, positions/equity are from Alpaca.
            </div>
            <div className="text-xs muted mt-1">
              Last synced: {reconcileStatus?.lastSyncedAt ? new Date(reconcileStatus.lastSyncedAt).toLocaleString() : 'Never'}
            </div>
            <div className="mt-2">
              <button className="btn btn-sm btn-primary" type="button" onClick={handleReconcileNow} disabled={reconciling}>
                {reconciling ? 'Reconciling…' : 'Reconcile Now'}
              </button>
            </div>
          </section>
        )}

        <section>
          <div className="l-grid-auto-250">
            <StatCard
              icon="⏱️"
              iconTone="soft"
              label="Broker Net Exposure"
              value={Number.isFinite(portfolioValue) ? formatCurrency(portfolioValue, 0) : '—'}
              subtitle={Number.isFinite(equityMinusCash) ? 'Live Alpaca equity - cash' : 'Broker exposure unavailable'}
            />
            <StatCard
              icon="📦"
              iconTone="soft"
              label="Holdings Market Value"
              value={Number.isFinite(modeledPortfolioValue) ? formatCurrency(modeledPortfolioValue, 0) : '—'}
              subtitle="Sum of displayed holdings"
            />
            <StatCard
              icon="🏦"
              iconTone="soft"
              label="Available Cash"
              value={Number.isFinite(cash) ? formatCurrency(cash, 0) : '—'}
              subtitle="Live Alpaca bankroll"
            />
            <StatCard
              icon="🧾"
              iconTone="soft"
              label="Total Equity"
              value={Number.isFinite(equity) ? formatCurrency(equity, 0) : '—'}
              subtitle="Broker account equity"
            />
            <StatCard
              icon="💳"
              iconTone="soft"
              label="Buying Power"
              value={Number.isFinite(buyingPower) ? formatCurrency(buyingPower, 0) : '—'}
              subtitle="Available purchasing capacity"
            />
            <StatCard
              icon="🤖"
              iconTone="soft"
              valueTone={pnlSnapshot.valueTone}
              label="Total Return ($)"
              value={pnlSnapshot.value}
              subtitle={pnlSnapshot.subtitle}
            />
            <StatCard
              icon="📊"
              iconTone="soft"
              valueTone={Number(stats?.totalReturnPct) > 0 ? 'positive' : Number(stats?.totalReturnPct) < 0 ? 'negative' : undefined}
              label="Total Return (%)"
              value={Number.isFinite(stats?.totalReturnPct) ? formatPercent(stats.totalReturnPct, { showSign: true, decimals: 1 }) : '—'}
              subtitle="Return on invested capital"
            />
            <StatCard
              icon="💼"
              iconTone="soft"
              label="Invested Capital"
              value={Number.isFinite(investedAmount) ? formatCurrency(investedAmount, 0) : '—'}
              subtitle="Cost basis across holdings"
            />
            <StatCard
              icon="🎯"
              iconTone="accent"
              label="Largest Position"
              value={
                largestPosition
                  ? `${largestPosition.ticker || '—'} ${formatCurrency(largestPosition.value, 0)}`
                  : '—'
              }
              subtitle={
                Number.isFinite(largestPosition?.weightPct)
                  ? `${formatPercent(largestPosition.weightPct, { decimals: 1 })} of portfolio`
                  : 'Top holding by value'
              }
            />
            <StatCard
              icon="⚠️"
              iconTone="soft"
              label="Concentration Risk"
              value={Number.isFinite(largestPosition?.weightPct) ? formatPercent(largestPosition.weightPct, { decimals: 1 }) : '—'}
              subtitle="Largest single-position weight"
            />
            <StatCard
              icon="📈"
              iconTone="accent"
              valueTone={biggestMoves.profit?.pnl > 0 ? 'positive' : undefined}
              label="Biggest Profit"
              value={biggestMoves.profit ? `${biggestMoves.profit.ticker} ${formatCurrency(biggestMoves.profit.pnl, 0)}` : '—'}
              subtitle="Largest unrealized gain"
            />
            <StatCard
              icon="⭐"
              iconTone="soft"
              valueTone={biggestMoves.loss?.pnl < 0 ? 'negative' : undefined}
              label="Biggest Loss"
              value={biggestMoves.loss ? `${biggestMoves.loss.ticker} ${formatCurrency(biggestMoves.loss.pnl, 0)}` : '—'}
              subtitle="Largest unrealized loss"
            />
            <StatCard
              icon="✅"
              iconTone="soft"
              label="Win Rate"
              value={Number.isFinite(stats?.winRate) ? formatPercent(stats.winRate, { decimals: 1 }) : '—'}
              subtitle="From performance metrics"
            />
            <StatCard
              icon="🔁"
              iconTone="soft"
              label="Total Trades"
              value={Number.isFinite(stats?.totalTrades) ? String(stats.totalTrades) : '—'}
              subtitle="Completed trading count"
            />
            <StatCard
              icon="⏳"
              iconTone="soft"
              label="Avg Hold Time"
              value={Number.isFinite(stats?.avgHoldTime) ? `${stats.avgHoldTime}d` : '—'}
              subtitle="Average holding duration"
            />
            <StatCard
              icon="🕒"
              iconTone="soft"
              label="Last Trade Age"
              value={lastTradeAge ?? '—'}
              subtitle="Time since most recent trade"
            />
          </div>
        </section>

        <section>
          <article className="card card-pad-sm">
            <h3 className="panel-title mb-3">Portfolio P/L History</h3>
            <PriceChart
              selectedStock={selectedStock}
              priceHistory={priceHistory}
              priceRange={priceRange}
              chartRange={chartRange}
              onRangeChange={setChartRange}
              loading={snapshotsLoading}
              compact={false}
              availableRanges={availableRanges}
            />
          </article>
        </section>

        <section>
          <article className="card">
            <div className="panel-header">
              <h3 className="panel-title">Watchlist</h3>
              <div className="l-row" style={{ gap: 10, alignItems: 'center' }}>
                <span className="muted text-sm text-nowrap">{watchlistCount ? `${watchlistCount} assets` : 'No assets yet'}</span>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate('/assets')}>
                  Browse Assets
                </button>
              </div>
            </div>

            {watchlistCount ? (
              <div className="data-rows" style={{ marginTop: 0 }}>
                {watchlistView.map((symbol, idx) => {
                  const divider = idx !== watchlistView.length - 1
                  const dividerClass = divider ? 'data-row-divider' : ''

                  const rawPrice = pricesService.getPrice(watchlistPriceMap, symbol)
                  const rawChange = pricesService.getChange(watchlistPriceMap, symbol)

                  const price = Number.isFinite(Number(rawPrice)) ? formatCurrency(Number(rawPrice)) : '—'
                  const changeValue = Number.isFinite(Number(rawChange)) ? Number(rawChange) : null
                  const change = changeValue == null ? null : formatPercent(changeValue, { showSign: true, decimals: 2 })
                  const changeTone = changeValue == null ? 'muted' : changeValue > 0 ? 'text-positive' : changeValue < 0 ? 'text-negative' : 'muted'

                  return (
                    <div key={symbol} className={`data-row-asset data-row-action ${dividerClass}`.trim()}>
                      <strong className="text-nowrap">{symbol}</strong>
                      <span className="muted text-ellipsis-one-line">
                        <span className="text-nowrap">{price}</span>
                        {change ? <span className={`text-nowrap ${changeTone}`}> {'·'} {change}</span> : null}
                      </span>
                      <div className="l-row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-xs btn-ghost"
                          type="button"
                          onClick={() => navigate(`/orders?ticker=${encodeURIComponent(symbol)}`)}
                        >
                          View
                        </button>
                        <button
                          className="btn btn-xs btn-primary"
                          type="button"
                          onClick={() => navigate(`/orders?ticker=${encodeURIComponent(symbol)}`)}
                        >
                          Trade
                        </button>
                        <button
                          className="btn btn-xs btn-ghost"
                          type="button"
                          onClick={() => {
                            const next = removeFromWatchlist(watchlist, symbol)
                            setWatchlist(next)
                            saveWatchlist(next)
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )
                })}

                {watchlistCount > watchlistView.length ? (
                  <div className="mt-2">
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate('/orders')}>
                      View all in Orders
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="muted text-sm" style={{ lineHeight: 1.5 }}>
                Add tickers to your watchlist from any asset page. We’ll keep them here for quick access.
              </div>
            )}
          </article>
        </section>

        <section>
          <article className="card">
            <div className="panel-header">
              <h3 className="panel-title">Holdings</h3>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate('/orders')}>
                Place Order
              </button>
            </div>
            <HoldingsTable holdings={holdings} />
          </article>
        </section>

        <section>
          <article className="card">
            <div className="panel-header">
              <h3 className="panel-title">Recent Activity</h3>
            </div>
            <ActivityFeed activities={recentActivity} />
          </article>
        </section>

      </div>
    </div>

  )
}
