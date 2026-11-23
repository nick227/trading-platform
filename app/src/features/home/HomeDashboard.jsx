import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ActivityFeed from '../../ui/ActivityFeed'
import BotRow from '../../ui/BotRow'
import ValueChart from '../../ui/ValueChart'
import { EmergencyBanner, SafetyBar, useEmergencyStop } from '../../ui/Safety'
import { Chevron } from '../../ui/Disclosure'
import { useBotControls } from '../../ui/useBotControls'
import { dateTime, listJoin, money, moneyWhole, plural, sessionDate, shares, signedMoney, signedPct, tone } from '../../ui/format'
import HoldingDetail from './HoldingDetail'
import { loadHome } from './homeApi'

export const fmtMoney = money
export const fmtSignedMoney = signedMoney
const MIN_CHART_POINTS = 5

// ── Portfolio ───────────────────────────────────────────────────────────────

function ValueHistory({ points, startingCash }) {
  if (points.length === 0) return null
  if (points.length < MIN_CHART_POINTS) {
    // Too few closes for a line to mean anything; show the values directly.
    return (
      <div className="tl-compare" data-testid="value-compare">
        {points.map((p, i) => (
          <Fragment key={p.t}>
            {i > 0 && <span className="tl-compare-arrow" aria-hidden="true">→</span>}
            <span className="tl-compare-item"><span className="tl-muted">{sessionDate(p.t)} close</span><b className="tl-num">{money(p.v)}</b></span>
          </Fragment>
        ))}
        <span className="tl-compare-note">A value chart appears after {MIN_CHART_POINTS} sessions.</span>
      </div>
    )
  }
  const markers = points.filter((p) => p.fills > 0).map((p) => ({ t: p.t, kind: 'buy', label: plural(p.fills, 'fill') }))
  return (
    <div style={{ marginTop: 22 }}>
      <ValueChart points={points} markers={markers} baseline={startingCash} baselineLabel={startingCash ? `Start ${moneyWhole(startingCash)}` : null} minSpan={(startingCash ?? 0) * 0.01} label="Portfolio value at each daily close" />
      <p className="tl-chart-caption">Value at each daily close since your first trade. Dots mark days with fills.</p>
    </div>
  )
}

function Portfolio({ valuation, history, error }) {
  if (error || !valuation) {
    return (
      <section className="tl-section" aria-labelledby="portfolio-title">
        <h2 className="tl-hero-label" id="portfolio-title" style={{ margin: 0 }}>Portfolio</h2>
        <div className="tl-hero-value" data-testid="balance-equity">—</div>
        <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 12 }}>{error ?? 'Your portfolio value couldn’t be loaded.'} Refresh to try again.</div>
      </section>
    )
  }
  if (valuation.source === 'none') {
    return (
      <section className="tl-section" aria-labelledby="portfolio-title">
        <h2 className="tl-hero-label" id="portfolio-title" style={{ margin: 0 }}>Portfolio</h2>
        <div className="tl-hero-value" data-testid="balance-equity">—</div>
        <div className="tl-notice" role="status" style={{ marginTop: 12 }}>
          <span>No trading account is connected, so there’s no balance to show. <Link to="/profile">Connect a paper account</Link> to run bots.</span>
        </div>
      </section>
    )
  }
  const v = valuation
  const pts = history?.points?.filter((p) => p.v !== null) ?? []
  return (
    <section className="tl-section" aria-labelledby="portfolio-title">
      <h2 className="tl-hero-label" id="portfolio-title" style={{ margin: 0 }}>{v.simulated ? 'Simulated portfolio' : 'Portfolio'}</h2>
      <div className="tl-hero-value" data-testid="balance-equity">{money(v.equity)}</div>
      {v.fillCount > 0 && v.totalPnl !== null && (
        <div className="tl-hero-change">
          <span className={tone(v.totalPnl)} data-testid="portfolio-total-pnl">
            {signedMoney(v.totalPnl)} ({signedPct(v.totalPnlPct)})
          </span>
          <span className="tl-muted">since you started with {moneyWhole(v.startingCash)}</span>
        </div>
      )}
      {v.equity === null && v.unpricedSymbols.length > 0 && (
        <p className="tl-asof">Total unavailable: no recent close for {listJoin(v.unpricedSymbols)}.</p>
      )}
      {v.fillCount > 0 && v.pricesAsOf && (
        <p className="tl-asof" data-testid="as-of">
          Valued at {sessionDate(v.pricesAsOf)} closing prices{v.simulated && v.session ? ` · simulated fills replay the ${sessionDate(v.session)} close` : ''}
        </p>
      )}
      {v.fillCount === 0 ? (
        <p className="tl-asof" data-testid="portfolio-all-cash">
          All cash — {money(v.cash)} available to your bots. Holdings, value history and P&amp;L appear after your first trade.
        </p>
      ) : (
        <>
          <ValueHistory points={pts} startingCash={v.startingCash} />
          <dl className="tl-stats" style={{ marginTop: 22 }}>
            <div className="tl-stat"><dt>Cash</dt><dd>{money(v.cash)}</dd></div>
            <div className="tl-stat"><dt>Invested</dt><dd>{money(v.marketValue)}<small>{plural(v.positions.length, 'holding')}</small></dd></div>
          </dl>
          <p className="tl-small tl-muted" style={{ marginBottom: 0 }}>{signedMoney(v.realizedPnl)} realized P&amp;L</p>
        </>
      )}
    </section>
  )
}

// ── Holdings ────────────────────────────────────────────────────────────────

/** Largest holding's share of invested value — straight from the valuation. */
function concentration(v) {
  const top = v?.positions?.[0]
  if (!top || !v.marketValue || top.marketValue === null) return null
  return <>Largest holding <strong>{top.symbol}</strong> · {((top.marketValue / v.marketValue) * 100).toFixed(0)}% of invested value</>
}

function Holdings({ valuation, bots, open, setOpen, busy, onToggleBot }) {
  const positions = valuation?.positions ?? []
  if (positions.length === 0) return null
  const botName = (id) => bots.find((b) => b.id === id)?.name ?? 'Stopped bot'
  return (
    <section className="tl-section" id="holdings" aria-labelledby="holdings-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="holdings-title">Holdings<span className="tl-count">{positions.length}</span></h2>
        <span className="tl-section-aside tl-muted tl-small tl-hide-sm">Select a holding for details</span>
      </div>
      <table className="tl-table" data-testid="holdings-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="r">Shares</th>
            <th className="r tl-hide-sm">Avg cost</th>
            <th className="r tl-hide-sm">Last close</th>
            <th className="r">Value</th>
            <th className="r">Return</th>
            <th aria-hidden="true" style={{ width: 24 }} />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const isOpen = open === p.symbol
            const owners = p.bots.map((b) => botName(b.botId))
            const ownerText = owners.length === 0 ? 'Not held by a bot' : owners.length === 1 ? owners[0] : `${owners[0]} +${owners.length - 1}`
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
                  <td><span className="tl-sym">{p.symbol}</span><span className="tl-sub">{ownerText}</span></td>
                  <td className="r">{shares(p.quantity)}</td>
                  <td className="r tl-hide-sm">{money(p.avgPrice)}</td>
                  <td className="r tl-hide-sm">{money(p.price)}</td>
                  <td className="r">{money(p.marketValue)}</td>
                  <td className={`r ${tone(p.unrealizedPnl)}`}>{signedMoney(p.unrealizedPnl)}<span className="tl-sub">{signedPct(p.unrealizedPct, 1)}</span></td>
                  <td className="r tl-faint"><Chevron open={isOpen} /></td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} className="tl-detail" style={{ padding: 0 }}>
                      <HoldingDetail position={p} bots={bots} busy={busy} onToggleBot={onToggleBot} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

// ── My bots ─────────────────────────────────────────────────────────────────

function MyBots({ bots, error, controls }) {
  const running = bots.filter((b) => b.running).length
  return (
    <section className="tl-section" id="bots" aria-labelledby="home-bots-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="home-bots-title">My bots{bots.length > 0 && <span className="tl-count">{running} of {bots.length} running</span>}</h2>
        <div className="tl-section-aside">
          {running > 1 && <button type="button" className="tl-btn tl-btn--sm" onClick={() => controls.pauseAll(bots)} disabled={controls.pausingAll}>{controls.pausingAll ? 'Pausing…' : 'Pause all'}</button>}
          {bots.length > 0 && <Link to="/bots">Bots →</Link>}
        </div>
      </div>
      {error ? (
        <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{error}</div>
      ) : bots.length === 0 ? (
        <div className="tl-empty">
          <p><strong>You don’t have any bots yet.</strong> A bot trades your simulated portfolio by conditions you set — a price trigger, a schedule, a trend, or Alpha Engine research — and you can pause it at any time.</p>
          <Link to="/bots" className="tl-btn tl-btn--primary">Build a bot</Link>
        </div>
      ) : (
        <ul className="tl-list tl-machine-list">
          {bots.map((bot) => <BotRow key={bot.id} bot={bot} busy={Boolean(controls.busy[bot.id])} error={controls.errors[bot.id]} onToggle={controls.toggle} from="home" />)}
        </ul>
      )}
    </section>
  )
}

function WorkshopOverview({ bots, error, activity }) {
  const running = bots.filter((bot) => bot.running).length
  const paused = bots.filter((bot) => bot.status === 'paused').length
  const attention = bots.filter((bot) => bot.status === 'error').length
  const stopped = bots.filter((bot) => bot.stopped).length
  const latest = (activity ?? []).find((item) => item.at && Number.isFinite(Date.parse(item.at)))
  return (
    <header className="tl-workshop-overview">
      <div className="tl-workshop-heading">
        <div><p className="tl-workshop-eyebrow">TradeLoom / Algorithm workshop</p>
          <h1>Your ideas, in motion.</h1>
          <p className="tl-muted">{error ? 'Your algorithms and portfolio, at a glance.' : bots.length ? 'Observe your algorithms. Understand their decisions.' : 'Turn a trading idea into your first algorithm.'}</p>
        </div>
        <Link to="/bots/new" className="tl-btn tl-btn--primary">Create bot <span aria-hidden="true">↗</span></Link>
      </div>
      {error ? <p className="tl-muted">Bot status unavailable</p> : (
        <div className="tl-workshop-status" aria-label="Workshop status" data-testid="workshop-status">
          <a href="#bots"><span className={`tl-workshop-dot${running ? '' : ' is-idle'}`} aria-hidden="true" /><strong>{running}</strong> running</a>
          <a href="#bots"><strong>{paused}</strong> paused</a>
          {stopped > 0 && <a href="#bots"><strong>{stopped}</strong> stopped</a>}
          {attention > 0 && <a className="tl-workshop-attention" href="#bots">{attention} running with an error</a>}
          <span className="tl-workshop-recorded">{latest ? `Latest recorded activity · ${dateTime(latest.at)}` : 'No recorded activity loaded'}</span>
        </div>
      )}
    </header>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

function HomeSkeleton() {
  return (
    <div data-testid="home-loading" aria-hidden="true">
      <span className="tl-skel" style={{ width: 160, height: 16 }} />
      <span className="tl-skel" style={{ width: 280, height: 44, marginTop: 10 }} />
      <span className="tl-skel" style={{ height: 64, marginTop: 24 }} />
      <span className="tl-skel" style={{ height: 160, marginTop: 48 }} />
      <span className="tl-skel" style={{ height: 160, marginTop: 48 }} />
    </div>
  )
}

export default function HomeDashboard() {
  const location = useLocation()
  const [state, setState] = useState({ loading: true, data: null })
  const [open, setOpen] = useState(null)
  const { stop, activate, clear } = useEmergencyStop()

  const refresh = useCallback(async () => {
    const data = await loadHome()
    setState({ loading: false, data })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const controls = useBotControls((fn) => setState((s) => ({ ...s, data: { ...s.data, bots: fn(s.data.bots) } })))

  // Deep links: /#holdings, /?holding=AAPL
  useEffect(() => {
    if (state.loading) return
    const holding = new URLSearchParams(location.search).get('holding')
    if (holding) setOpen(holding.toUpperCase())
    const id = holding ? 'holdings' : location.hash.replace('#', '')
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' })
  }, [state.loading, location.hash, location.search])

  const onActivate = async (reason) => { await activate(reason); await refresh() }
  const data = state.data

  return (
    <main className="tl-page tl-workshop-home" aria-busy={state.loading}>
      <EmergencyBanner stop={stop} onClear={clear} />
      {state.loading ? (
        <HomeSkeleton />
      ) : (
        <>
          <WorkshopOverview bots={data.bots} error={data.botsError} activity={data.activity} />
          <div className={`tl-workshop-dashboard${data.bots.length ? '' : ' tl-workshop-dashboard--empty'}`}>
            <Portfolio valuation={data.valuation} history={data.history} error={data.valuationError} />
            {data.bots.length > 0 && (
              <section className="tl-section" id="activity" aria-labelledby="home-activity-title">
                <div className="tl-section-head">
                  <h2 className="tl-section-title" id="home-activity-title">Recent decisions & activity</h2>
                  <Link className="tl-section-aside" to="/bots#activity">Full history →</Link>
                </div>
                {data.activityError ? (
                  <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{data.activityError}</div>
                ) : (
                  <ActivityFeed items={data.activity} limit={3} narrative showLensControl={false}
                    empty="Nothing yet — your bots’ trades and decisions appear here." />
                )}
              </section>
            )}
          </div>
          {data.bots.length > 0 && <SafetyBar stop={stop} onActivate={onActivate} fact={concentration(data.valuation)} />}
          {/* New accounts see their bots first; sections without content stay out of the way. */}
          {data.bots.length === 0 && !data.botsError && <MyBots bots={data.bots} error={data.botsError} controls={controls} />}
          {(data.bots.length > 0 || data.botsError) && <MyBots bots={data.bots} error={data.botsError} controls={controls} />}
          <Holdings valuation={data.valuation} bots={data.bots} open={open} setOpen={setOpen} busy={controls.busy} onToggleBot={controls.toggle} />
          <p className="tl-small tl-faint" style={{ marginTop: 56 }}>
            {data.valuation?.simulated
              ? 'Simulated money · fills replay historical closes, not broker executions · research is an input, not a recommendation.'
              : 'Paper trading only — live trading is disabled.'}
          </p>
        </>
      )}
    </main>
  )
}
