import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useApp } from '../app/AppProvider.jsx'
import { useAuth } from '../app/AuthProvider.jsx'
import pricesService from '../api/services/pricesService.js'
import StatCard from '../components/StatCard.jsx'
import PortfolioHeader from './portfolio/PortfolioHeader.jsx'
import HoldingsTable from './portfolio/HoldingsTable.jsx'
import ActivityFeed from './portfolio/ActivityFeed.jsx'
import { loadWatchlist, removeFromWatchlist, saveWatchlist } from '../utils/watchlist.js'
import { formatCurrency, formatPercent } from '../utils/format.js'

export default function Portfolio() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { state } = useApp()
  const { holdings, stats, recentActivity, loading, error, refetch } = usePortfolio()

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
      setWatchlistPriceMap(null)
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

  if (loading) {
    return (
      <div className="l-page loading">
        <div className="indicator">Loading portfolio</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="l-page">
        <div className="container l-stack-md">
          <div className="text-negative mb-3">Failed to load portfolio: {error}</div>
          <button className="btn btn-sm btn-ghost" type="button" onClick={refetch}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="l-page">
      <div className="container l-stack-lg">
        <header className="mb-0">
          <PortfolioHeader user={user} stats={stats} onRefresh={refetch} />
        </header>

        <section>
          <div className="l-grid-auto-250">
            <StatCard
              icon="⏱️"
              iconTone="soft"
              label="Portfolio Value"
              value={Number.isFinite(stats?.totalValue) ? formatCurrency(stats.totalValue, 0) : '—'}
              subtitle="Total market value"
            />
            <StatCard
              icon="🤖"
              iconTone="soft"
              valueTone={pnlSnapshot.valueTone}
              label="P&L Snapshot"
              value={pnlSnapshot.value}
              subtitle={pnlSnapshot.subtitle}
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
          </div>
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
