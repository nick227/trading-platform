import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { controlErrorMessage, deriveStatus, STATUS_LABELS } from '../../api/services/botDashboardService'
import ActivityFeed from '../../ui/ActivityFeed'
import ValueChart from '../../ui/ValueChart'
import { ago, listJoin, money, moneyWhole, plural, sessionDate, shares, signedMoney, signedPct, tone } from '../../ui/format'
import HoldingDetail from './HoldingDetail'
import { loadHome, loadTransactions, pauseAllBots, setBotRunning } from './homeApi'

// Holding colours: ink scale, so the allocation reads as one family (not a rainbow).
const ALLOC = ['#2f2a6b', '#5b3fd6', '#8b78e6', '#b6aaf0', '#d9d2f7', '#9a9aa3']

export const fmtMoney = money
export const fmtSignedMoney = signedMoney

// ── Portfolio ───────────────────────────────────────────────────────────────

function Portfolio({ valuation, history, error }) {
  if (error || !valuation) {
    return (
      <section className="tl-section" aria-labelledby="portfolio-title">
        <h1 className="tl-hero-label" id="portfolio-title" style={{ margin: 0 }}>Portfolio</h1>
        <div className="tl-hero-value" data-testid="balance-equity">—</div>
        <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 12 }}>{error ?? 'Your portfolio value couldn’t be loaded.'} Refresh to try again.</div>
      </section>
    )
  }
  if (valuation.source === 'none') {
    return (
      <section className="tl-section" aria-labelledby="portfolio-title">
        <h1 className="tl-hero-label" id="portfolio-title" style={{ margin: 0 }}>Portfolio</h1>
        <div className="tl-hero-value" data-testid="balance-equity">—</div>
        <div className="tl-notice" role="status" style={{ marginTop: 12 }}>
          <span>No trading account is connected, so there’s no balance to show. <Link to="/profile/broker">Connect a paper account</Link> to run bots.</span>
        </div>
      </section>
    )
  }
  const v = valuation
  const pts = history?.points?.filter((p) => p.v !== null) ?? []
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  // A one-day change is shown only once it differs from the since-start change.
  const day = last && prev && pts.length >= 3 ? last.v - prev.v : null
  const dayPct = day !== null && prev.v ? (day / prev.v) * 100 : null
  const markers = (history?.points ?? []).filter((p) => p.fills > 0).map((p) => ({ t: p.t, kind: 'buy', label: plural(p.fills, 'fill') }))

  const slices = v.positions.filter((p) => p.marketValue !== null).slice(0, 5)
  const otherValue = v.positions.slice(5).reduce((s, p) => s + (p.marketValue ?? 0), 0)

  return (
    <section className="tl-section" aria-labelledby="portfolio-title">
      <div className="tl-summary-top">
        <div>
          <h1 className="tl-hero-label" id="portfolio-title" style={{ margin: 0 }}>{v.simulated ? 'Simulated portfolio' : 'Portfolio'}</h1>
          <div className="tl-hero-value" data-testid="balance-equity">{money(v.equity)}</div>
          <div className="tl-hero-change">
            {v.totalPnl !== null && v.fillCount > 0 && (
              <span className={tone(v.totalPnl)} data-testid="portfolio-total-pnl">
                {signedMoney(v.totalPnl)} ({signedPct(v.totalPnlPct)}) <span className="tl-muted">since start</span>
              </span>
            )}
            {day !== null && (
              <span className={tone(day)} data-testid="balance-today">
                {signedMoney(day)} ({signedPct(dayPct)}) <span className="tl-muted">{sessionDate(last.t)}</span>
              </span>
            )}
          </div>
          {v.equity === null && v.unpricedSymbols.length > 0 && (
            <p className="tl-small tl-muted" style={{ margin: '6px 0 0' }}>Total unavailable: no recent close for {listJoin(v.unpricedSymbols)}.</p>
          )}
        </div>
        <div className="tl-asof">
          {v.pricesAsOf ? <>Prices at the {sessionDate(v.pricesAsOf)} close</> : v.fillCount === 0 ? null : 'Prices unavailable'}
          {v.simulated && v.session && <><br />Fills replay the {sessionDate(v.session)} close</>}
        </div>
      </div>

      {v.fillCount === 0 ? (
        <p className="tl-small tl-muted" style={{ margin: '14px 0 0' }} data-testid="portfolio-all-cash">
          All cash — {money(v.cash)} available to your bots. Holdings, a value chart and P&amp;L appear after your first fill.
        </p>
      ) : pts.length === 0 ? (
        <div className="tl-chart-empty" style={{ marginTop: 20 }}>
          {history?.source === 'unavailable' ? 'Value history isn’t recorded for this account type.' : 'Your value chart starts with your first fill.'}
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <ValueChart points={pts} markers={markers} baseline={v.startingCash} baselineLabel={v.startingCash ? `Start ${moneyWhole(v.startingCash)}` : null} height={pts.length < 4 ? 160 : 220} label="Portfolio value at each daily close" />
          <p className="tl-chart-caption">
            Value at each daily close since your first fill{pts.length < 5 ? ` — ${plural(pts.length, 'session')} so far` : ''}. Dots mark days with fills.
          </p>
        </div>
      )}

      {v.fillCount > 0 && (<>
      <dl className="tl-stats" style={{ marginTop: 20 }}>
        <div className="tl-stat"><dt>Cash</dt><dd>{money(v.cash)}</dd></div>
        <div className="tl-stat"><dt>Invested</dt><dd>{money(v.marketValue)}<small>{plural(v.positions.length, 'holding')}</small></dd></div>
        <div className="tl-stat"><dt>Unrealized P&amp;L</dt><dd className={tone(v.unrealizedPnl)}>{signedMoney(v.unrealizedPnl)}</dd></div>
        <div className="tl-stat"><dt>Realized P&amp;L</dt><dd className={tone(v.realizedPnl)}>{signedMoney(v.realizedPnl)}<small>{plural(v.fillCount, 'fill')}</small></dd></div>
      </dl>

      {v.equity !== null && v.equity > 0 && (
        <div className="tl-alloc" aria-label="Allocation">
          <div className="tl-alloc-bar">
            {slices.map((p, i) => <span key={p.symbol} style={{ width: `${(p.marketValue / v.equity) * 100}%`, background: ALLOC[i] }} title={`${p.symbol} ${money(p.marketValue)}`} />)}
            {otherValue > 0 && <span style={{ width: `${(otherValue / v.equity) * 100}%`, background: ALLOC[5] }} />}
            <span style={{ flex: 1, background: 'var(--tl-surface-3)' }} title={`Cash ${money(v.cash)}`} />
          </div>
          <div className="tl-alloc-legend">
            {slices.map((p, i) => <span key={p.symbol}><i style={{ background: ALLOC[i] }} />{p.symbol} {((p.marketValue / v.equity) * 100).toFixed(1)}%</span>)}
            <span><i style={{ background: 'var(--tl-line-strong)' }} />Cash {v.cash !== null ? ((v.cash / v.equity) * 100).toFixed(1) : '—'}%</span>
          </div>
        </div>
      )}
      </>)}
    </section>
  )
}

// ── Holdings ────────────────────────────────────────────────────────────────

function Holdings({ valuation, bots, open, setOpen, busy, onToggleBot }) {
  const positions = valuation?.positions ?? []
  const botName = (id) => bots.find((b) => b.id === id)?.name
  return (
    <section className="tl-section" id="holdings" aria-labelledby="holdings-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="holdings-title">Holdings{positions.length > 0 && <span className="tl-count">{positions.length}</span>}</h2>
      </div>
      {positions.length === 0 ? (
        <div className="tl-empty">
          <p><strong>No holdings yet.</strong> When one of your bots’ orders fills, the position appears here, valued at the latest close.</p>
        </div>
      ) : (
        <table className="tl-table" data-testid="holdings-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="r">Shares</th>
              <th className="r tl-hide-sm">Avg cost</th>
              <th className="r tl-hide-sm">Last close</th>
              <th className="r">Value</th>
              <th className="r">Return</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const isOpen = open === p.symbol
              const owners = p.bots.map((b) => botName(b.botId)).filter(Boolean)
              return (
                <Fragment key={p.symbol}>
                  <tr
                    className={`tl-row-click ${isOpen ? 'tl-row-open' : ''}`}
                    onClick={() => setOpen(isOpen ? null : p.symbol)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : p.symbol) } }}
                    tabIndex={0}
                    aria-expanded={isOpen}
                    data-testid="holding-row"
                  >
                    <td><span className="tl-sym">{p.symbol}</span><span className="tl-sub">{owners.length ? listJoin(owners, 2) : 'Manual'}</span></td>
                    <td className="r">{shares(p.quantity)}</td>
                    <td className="r tl-hide-sm">{money(p.avgPrice)}</td>
                    <td className="r tl-hide-sm">{money(p.price)}<span className="tl-sub">{p.priceSession ? sessionDate(p.priceSession) : 'unavailable'}</span></td>
                    <td className="r">{money(p.marketValue)}</td>
                    <td className={`r ${tone(p.unrealizedPnl)}`}>{signedMoney(p.unrealizedPnl)}<span className="tl-sub">{signedPct(p.unrealizedPct, 1)}</span></td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="tl-detail" style={{ padding: 0 }}>
                        <HoldingDetail position={p} bots={bots} busy={busy} onToggleBot={onToggleBot} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ── My bots (portfolio context) ─────────────────────────────────────────────

function lastActivityText(bot) {
  const a = bot.lastActivity
  if (a) return `${a.title}${a.symbol && !a.title.includes(a.symbol) ? ` · ${a.symbol}` : ''} · ${ago(a.at)}`
  return bot.activityAvailable ? 'No activity yet' : 'Activity unavailable'
}

export function BotRow({ bot, busy, error, onToggle }) {
  const control = bot.stopped ? null : bot.running ? 'Pause' : 'Resume'
  const pnl = bot.performance?.total ?? null
  const holdings = Object.keys(bot.openPositions ?? {})
  return (
    <li className="tl-bot" data-testid="bot-card">
      <Link to={`/bots/${bot.id}`} state={{ from: 'home' }} className="tl-bot-main" aria-label={`${bot.name}, ${STATUS_LABELS[bot.status]}`}>
        <span className="tl-bot-name"><span>{bot.name}</span><span className={`tl-status tl-status--${bot.status}`} data-testid="bot-status">{STATUS_LABELS[bot.status]}</span></span>
        <span className="tl-bot-meta">
          <span>{holdings.length ? `Holds ${listJoin(holdings, 3)}` : bot.tickers.length ? `Watches ${listJoin(bot.tickers, 3)}` : 'No symbols'}</span>
          <span>{bot.capitalInUse !== null && bot.allocation !== null ? `${moneyWhole(bot.capitalInUse)} of ${moneyWhole(bot.allocation)} in use` : bot.allocation !== null ? `${moneyWhole(bot.allocation)} capital` : 'Capital not set'}</span>
          <span data-testid="bot-last-activity">{lastActivityText(bot)}</span>
        </span>
      </Link>
      <div className="tl-bot-side">
        <div className="tl-bot-figure">
          {pnl !== null ? <b className={tone(pnl)} data-testid="bot-pnl">{signedMoney(pnl)}</b> : <b className="tl-faint">—</b>}
          <span>{pnl !== null ? 'P&L' : bot.performance ? 'P&L pending prices' : 'No fills yet'}</span>
        </div>
        {control && (
          <button type="button" className="tl-btn tl-btn--sm" onClick={() => onToggle(bot)} disabled={busy} aria-label={`${control} ${bot.name}`} style={{ minWidth: 76 }}>
            {busy ? 'Saving…' : control}
          </button>
        )}
      </div>
      {error && <div className="tl-bot-error" role="alert">{error}</div>}
    </li>
  )
}

function MyBots({ bots, error, busy, errors, onToggle, onPauseAll, pausingAll }) {
  const running = bots.filter((b) => b.running).length
  return (
    <section className="tl-section" id="bots" aria-labelledby="home-bots-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="home-bots-title">My bots{bots.length > 0 && <span className="tl-count">{running} of {bots.length} running</span>}</h2>
        <div className="tl-section-aside">
          {running > 1 && <button type="button" className="tl-btn tl-btn--sm" onClick={onPauseAll} disabled={pausingAll}>{pausingAll ? 'Pausing…' : 'Pause all'}</button>}
          {bots.length > 0 && <Link to="/bots">All bots →</Link>}
        </div>
      </div>
      {error ? (
        <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{error}</div>
      ) : bots.length === 0 ? (
        <div className="tl-empty">
          <p><strong>You don’t have any bots yet.</strong> A bot trades your simulated portfolio by rules you can read — buy on verified research, accumulate on a schedule, or follow a trend. You can pause it at any time.</p>
          <Link to="/bots" className="tl-btn tl-btn--primary">Explore bots</Link>
        </div>
      ) : (
        <ul className="tl-list">
          {bots.map((bot) => <BotRow key={bot.id} bot={bot} busy={Boolean(busy[bot.id])} error={errors[bot.id]} onToggle={onToggle} />)}
        </ul>
      )}
    </section>
  )
}

// ── History (transactions) ──────────────────────────────────────────────────

function History({ initial, botNames }) {
  const [state, setState] = useState(initial ?? null)
  const [loading, setLoading] = useState(false)
  useEffect(() => setState(initial ?? null), [initial])
  const more = async () => {
    setLoading(true)
    try {
      const next = await loadTransactions(state.nextCursor)
      setState((s) => ({ items: [...s.items, ...next.items], nextCursor: next.nextCursor, hasMore: next.hasMore }))
    } finally {
      setLoading(false)
    }
  }
  const [view, setView] = useState('filled')
  const all = state?.items ?? []
  const isFilled = (x) => x.status === 'filled' || x.status === 'partially_filled'
  const items = view === 'filled' ? all.filter(isFilled) : all
  const otherCount = all.length - all.filter(isFilled).length
  return (
    <section className="tl-section" id="history" aria-labelledby="history-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="history-title">Transactions</h2>
        {otherCount > 0 && (
          <div className="tl-seg" role="group" aria-label="Which orders">
            <button type="button" aria-pressed={view === 'filled'} onClick={() => setView('filled')}>Filled</button>
            <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>All orders</button>
          </div>
        )}
      </div>
      {state === null ? (
        <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>Transactions couldn’t be loaded.</div>
      ) : items.length === 0 && view === 'filled' && all.length > 0 ? (
        <div className="tl-empty"><p>No fills yet — {otherCount} {otherCount === 1 ? 'order was' : 'orders were'} not filled. <button type="button" className="tl-link-btn" onClick={() => setView('all')}>Show all orders</button></p></div>
      ) : items.length === 0 ? (
        <div className="tl-empty"><p>No orders yet. Every order your bots place — filled, rejected or cancelled — is listed here.</p></div>
      ) : (
        <>
          <table className="tl-table" data-testid="transactions-table">
            <thead>
              <tr>
                <th>Order</th>
                <th className="r tl-hide-sm">Price</th>
                <th className="r">Amount</th>
                <th className="r tl-hide-sm">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => {
                const q = x.filledQuantity ?? x.quantity
                const px = x.filledPrice ?? x.intentPrice
                const amt = q !== null && px !== null ? q * px : null
                const filled = x.status === 'filled' || x.status === 'partially_filled'
                return (
                  <tr key={x.id}>
                    <td>
                      <span style={{ fontWeight: 560 }}>{x.side === 'sell' ? 'Sell' : 'Buy'} {shares(q)} <span className="tl-sym">{x.symbol}</span></span>
                      <span className="tl-sub">{x.replaySession ? `Replay of ${sessionDate(x.replaySession)}` : sessionDate(x.filledAt ?? x.createdAt)} · {x.botId ? botNames.get(x.botId) ?? 'Stopped bot' : 'Manual'}</span>
                    </td>
                    <td className="r tl-hide-sm">{money(px)}</td>
                    <td className="r">{money(amt)}</td>
                    <td className="r tl-hide-sm">{filled ? (x.replaySession ? <span className="tl-tag tl-tag--sim">Simulated fill</span> : <span className="tl-tag">Filled</span>) : <span className="tl-tag tl-tag--warn" title={x.cancelReason ?? undefined}>{x.status === 'cancelled' ? 'Cancelled' : x.status === 'failed' ? 'Rejected' : x.status}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {state.hasMore && (
            <button type="button" className="tl-btn tl-btn--sm tl-feed-more" onClick={more} disabled={loading}>{loading ? 'Loading…' : 'Show older transactions'}</button>
          )}
        </>
      )}
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

function HomeSkeleton() {
  return (
    <div data-testid="home-loading" aria-hidden="true">
      <span className="tl-skel" style={{ width: 160, height: 16 }} />
      <span className="tl-skel" style={{ width: 280, height: 44, marginTop: 10 }} />
      <span className="tl-skel" style={{ height: 200, marginTop: 24 }} />
      <span className="tl-skel" style={{ height: 64, marginTop: 20 }} />
      <span className="tl-skel" style={{ height: 160, marginTop: 48 }} />
    </div>
  )
}

export default function HomeDashboard() {
  const location = useLocation()
  const [state, setState] = useState({ loading: true, data: null })
  const [busy, setBusy] = useState({})
  const [errors, setErrors] = useState({})
  const [open, setOpen] = useState(null)
  const [pausingAll, setPausingAll] = useState(false)

  const refresh = useCallback(async () => {
    const data = await loadHome()
    setState({ loading: false, data })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Deep links: /#holdings, /#history, /?holding=AAPL
  useEffect(() => {
    if (state.loading) return
    const holding = new URLSearchParams(location.search).get('holding')
    if (holding) setOpen(holding.toUpperCase())
    const id = holding ? 'holdings' : location.hash.replace('#', '')
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' })
  }, [state.loading, location.hash, location.search])

  const patchBots = (ids, running) => setState((s) => ({
    ...s,
    data: {
      ...s.data,
      bots: s.data.bots.map((b) => {
        if (!ids.includes(b.id)) return b
        const next = { ...b, enabled: running, running }
        return { ...next, status: deriveStatus(next, next.lastActivity ? [next.lastActivity] : []) }
      }),
    },
  }))

  const toggleBot = async (bot) => {
    const resuming = !bot.running
    setBusy((b) => ({ ...b, [bot.id]: true }))
    setErrors((e) => ({ ...e, [bot.id]: null }))
    try {
      await setBotRunning(bot.id, resuming)
      patchBots([bot.id], resuming)
    } catch (err) {
      setErrors((e) => ({ ...e, [bot.id]: controlErrorMessage(err, resuming ? 'resume' : 'pause') }))
    } finally {
      setBusy((b) => ({ ...b, [bot.id]: false }))
    }
  }

  const pauseAll = async () => {
    setPausingAll(true)
    const results = await pauseAllBots(state.data.bots)
    patchBots(results.filter((r) => r.ok).map((r) => r.id), false)
    setErrors((e) => ({ ...e, ...Object.fromEntries(results.filter((r) => !r.ok).map((r) => [r.id, controlErrorMessage(null, 'pause')])) }))
    setPausingAll(false)
  }

  const data = state.data
  const botNames = useMemo(() => data?.botNames ?? new Map(), [data])

  return (
    <main className="tl-page" aria-busy={state.loading}>
      {state.loading ? (
        <HomeSkeleton />
      ) : (
        <>
          <Portfolio valuation={data.valuation} history={data.history} error={data.valuationError} />
          {/* New accounts see their bots first; sections without content stay out of the way. */}
          {data.bots.length === 0 && !data.botsError && <MyBots bots={data.bots} error={data.botsError} busy={busy} errors={errors} onToggle={toggleBot} onPauseAll={pauseAll} pausingAll={pausingAll} />}
          {(data.valuation?.positions?.length ?? 0) > 0 || data.bots.length > 0 ? (
            <Holdings valuation={data.valuation} bots={data.bots} open={open} setOpen={setOpen} busy={busy} onToggleBot={toggleBot} />
          ) : null}
          {(data.bots.length > 0 || data.botsError) && <MyBots bots={data.bots} error={data.botsError} busy={busy} errors={errors} onToggle={toggleBot} onPauseAll={pauseAll} pausingAll={pausingAll} />}
          {data.bots.length > 0 && (
            <section className="tl-section" id="activity" aria-labelledby="home-activity-title">
              <div className="tl-section-head">
                <h2 className="tl-section-title" id="home-activity-title">Recent activity</h2>
              </div>
              {data.activityError ? (
                <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{data.activityError}</div>
              ) : (
                <ActivityFeed items={data.activity} limit={6} routine="summary" empty="Your bots haven’t done anything yet. Checks, decisions and fills appear here as they run." />
              )}
            </section>
          )}
          {(data.transactions === null || data.transactions.items.length > 0) && <History initial={data.transactions} botNames={botNames} />}
          <p className="tl-small tl-faint" style={{ marginTop: 56 }}>
            Simulated money only — live trading is disabled.{data.valuation?.simulated && ' Fills replay historical closes and are not broker executions.'} <Link to="/research">Market research</Link>
          </p>
        </>
      )}
    </main>
  )
}
