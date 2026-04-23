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
              iconTone="positive"
              valueTone="positive"
              label="Active Bots"
              value={`${stats?.activeBots.running ?? 0} / ${stats?.activeBots.total ?? 0}`}
              subtitle="Currently running / total created"
            />
            <StatCard
              icon="📈"
              iconTone="accent"
              label="Top Strategy"
              value={stats?.topStrategy.return !== 0 ? `${stats?.topStrategy.return}%` : 'N/A'}
              subtitle={stats?.topStrategy.name}
            />
            <StatCard
              icon="⭐"
              iconTone="soft"
              label="Most Traded Asset"
              value={stats?.mostTradedAsset ?? '—'}
              subtitle="Asset with highest activity"
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
                          onClick={() => navigate(`/assets/${encodeURIComponent(symbol)}`)}
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
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate('/assets')}>
                      View all in Assets
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
