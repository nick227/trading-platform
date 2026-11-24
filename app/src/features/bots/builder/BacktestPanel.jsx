import { useEffect, useRef, useState } from 'react'
import { get, post } from '../../../api/client'
import Disclosure from '../../../ui/Disclosure'
import ValueChart from '../../../ui/ValueChart'
import { money, moneyWhole, plural, sessionDate, signedMoney, tone } from '../../../ui/format'

const RANGES = ['1Y', '3Y', '5Y']
const MODELS = [
  { id: 'next_open', label: 'Next open', hint: 'Decides at each close, fills at the next session’s open (realistic).' },
  { id: 'same_close', label: 'Same close', hint: 'Fills at the close it observed, like paper trading (optimistic).' },
]
const POLL_MS = 1500
const MAX_POLLS = 160

const signedPct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`)

const SKIP_TEXT = {
  price_above_threshold_not_met: 'price wasn’t above the trigger',
  price_below_threshold_not_met: 'price wasn’t below the trigger',
  cooldown_active: 'cooldown',
  position_limit_reached: 'position limit',
  daily_loss_limit_reached: 'daily loss limit',
  time_window_outside: 'outside the time window',
  market_closed: 'market closed',
  trend_filter_regime_mismatch: 'trend condition not met',
  trend_filter_not_confirmed: 'trend not confirmed',
  trend_filter_missing_snapshot: 'no trend data yet',
  no_position: 'nothing to sell',
  invalid_quantity: 'order too small',
  inflight_exists: 'order already pending',
  no_session_bar: 'no price that day',
}
const BLOCK_TEXT = {
  execution_weak: 'thin trading volume',
  execution_moderate: 'below-average volume',
  exposure_critical: 'portfolio too concentrated',
  exposure_warning: 'portfolio concentration',
  stress_critical: 'account under stress',
  stress_warning: 'account under stress',
}
const REFUSAL_TEXT = {
  bot_allocation_exceeded: 'its capital was fully used',
  max_order_value: 'over the per-order limit',
  sell_exceeds_attributable_holdings: 'not enough shares to sell',
  insufficient_buying_power: 'not enough cash',
  daily_loss_limit: 'daily loss limit',
}

function issueText(i) {
  if (i.type === 'price_basis_adjusted') return `${i.ticker}: prices before ${sessionDate(i.date, { year: true })} were on a different share basis (×${i.factor >= 1 ? i.factor : (1 / i.factor).toFixed(0)}); adjusted so returns aren’t distorted.`
  if (i.type === 'available_from') return `${i.ticker}: history starts ${sessionDate(i.date, { year: true })}; it trades from then.`
  if (i.type === 'missing_sessions') return `${i.ticker}: ${plural(i.count, 'session')} without a price; no decisions on those days.`
  if (i.type === 'unexplained_jump') return `${i.ticker}: an unexplained price jump on ${sessionDate(i.date, { year: true })}; this symbol was left out.`
  if (i.type === 'duplicate_date') return `${i.ticker}: a duplicate price on ${sessionDate(i.date, { year: true })} was ignored.`
  if (i.type === 'malformed_bar_dropped') return `${i.ticker}: an invalid price on ${sessionDate(i.date, { year: true })} was ignored.`
  return null
}

/** Why a run placed few or no trades: the most common reasons, in plain words. */
function whyQuiet(r) {
  const reasons = []
  for (const [k, n] of Object.entries(r.skips ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3)) reasons.push(`${SKIP_TEXT[k] ?? k.replace(/_/g, ' ')} (${n}×)`)
  const blocks = {}
  const refusals = {}
  for (const e of r.events ?? []) {
    if (e.type === 'risk_blocked') blocks[e.reason] = (blocks[e.reason] ?? 0) + 1
    if (e.type === 'refused') refusals[e.reason] = (refusals[e.reason] ?? 0) + 1
  }
  for (const [k, n] of Object.entries(blocks)) reasons.push(`risk check: ${BLOCK_TEXT[k] ?? k.replace(/_/g, ' ')} (${n}×)`)
  for (const [k, n] of Object.entries(refusals)) reasons.push(`${REFUSAL_TEXT[k] ?? k.replace(/_/g, ' ')} (${n}×)`)
  return reasons
}

export function BacktestResults({ run }) {
  const r = run.results
  const m = r.metrics
  const bh = r.buyAndHold
  const beat = m.returnPct !== null && bh?.returnPct !== null && bh?.returnPct !== undefined ? m.returnPct - bh.returnPct : null
  const issues = (run.dataIssues ?? []).map(issueText).filter(Boolean)
  const quiet = whyQuiet(r)
  return (
    <div className="tl-backtest-results" data-testid="backtest-results">
      <p className="tl-backtest-label">
        <span className="tl-tag">Hypothetical</span>{' '}
        {sessionDate(r.range.firstSession, { year: true })} – {sessionDate(r.range.lastSession, { year: true })} · {plural(r.range.sessions, 'session')} · {r.executionModelLabel}
      </p>
      <dl className="tl-stats tl-stats--4" style={{ borderTop: 0 }}>
        <div className="tl-stat"><dt>Return</dt><dd className={tone(m.returnPct)} data-testid="bt-return">{signedPct(m.returnPct)}<small>{signedMoney(m.pnl)} on {moneyWhole(r.capital)}</small></dd></div>
        <div className="tl-stat"><dt>Buy &amp; hold</dt><dd className={tone(bh?.returnPct)} data-testid="bt-buyhold">{signedPct(bh?.returnPct)}<small>{beat === null ? 'same symbols, same capital' : beat >= 0 ? `bot ahead by ${beat.toFixed(2)} pts` : `bot behind by ${Math.abs(beat).toFixed(2)} pts`}</small></dd></div>
        <div className="tl-stat"><dt>Max drawdown</dt><dd data-testid="bt-drawdown">{m.maxDrawdown ? `−${money(m.maxDrawdown.amount)}` : 'None'}<small>{m.maxDrawdown ? `${m.maxDrawdown.pct?.toFixed(2)}% · buy & hold ${bh?.maxDrawdown ? `${bh.maxDrawdown.pct?.toFixed(2)}%` : 'none'}` : 'peak to trough'}</small></dd></div>
        <div className="tl-stat"><dt>Trades</dt><dd data-testid="bt-trades">{m.trades}<small>{m.winRate !== null ? `${Math.round(m.winRate * 100)}% of ${plural(m.closedTrades, 'closed trade')} won` : 'no closed trades'} · in market {m.timeInMarketPct}%</small></dd></div>
      </dl>
      {r.curve.length >= 2 && (
        <>
          <ValueChart points={r.curve.map((p) => ({ t: p.date, v: p.equity }))} baseline={r.capital} baselineLabel={`Start ${moneyWhole(r.capital)}`}
            markers={[]} height={200} label="Hypothetical bot value at each daily close" minSpan={r.capital * 0.01} />
          <p className="tl-chart-caption">Bot value (its capital plus P&amp;L) at each close. Buy &amp; hold puts the same capital into the same symbols on day one.</p>
        </>
      )}
      {m.trades === 0 && quiet.length > 0 && (
        <p className="tl-small" data-testid="bt-why-quiet">It didn’t trade: {quiet.join('; ')}.</p>
      )}
      {m.trades > 0 && quiet.length > 0 && (
        <p className="tl-small tl-muted" data-testid="bt-why-quiet">Most days without a trade: {quiet.join('; ')}.</p>
      )}
      {issues.length > 0 && (
        <ul className="tl-backtest-notes" data-testid="bt-data-notes">
          {issues.slice(0, 6).map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      {r.trades.length > 0 && (
        <Disclosure label="Hypothetical trades" meta={plural(r.trades.length, 'fill')} testId="bt-trades-list">
          <table className="tl-table">
            <thead><tr><th>Filled</th><th>Side</th><th>Symbol</th><th className="r">Shares</th><th className="r">Price</th><th className="r">Realized</th></tr></thead>
            <tbody>
              {r.trades.slice(-100).reverse().map((t, i) => (
                <tr key={`${t.session}-${t.ticker}-${i}`}>
                  <td>{sessionDate(t.session, { year: true })}</td>
                  <td>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                  <td>{t.ticker}</td>
                  <td className="r">{t.quantity}</td>
                  <td className="r">{money(t.price)}</td>
                  <td className={`r ${tone(t.realizedPnl)}`}>{t.realizedPnl === null ? '—' : signedMoney(t.realizedPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.trades.length > 100 && <p className="tl-small tl-muted">Showing the latest 100.</p>}
        </Disclosure>
      )}
      <Disclosure label="How this was simulated" testId="bt-method">
        <ul className="tl-backtest-notes">
          {r.assumptions.map((a) => <li key={a}>{a}</li>)}
          <li>Same rules and risk policy as paper trading ({r.riskPolicyVersion}).</li>
          <li className="tl-muted">Data fingerprint {run.dataFingerprint?.slice(0, 12)} · config {run.configHash?.slice(0, 12)}</li>
        </ul>
      </Disclosure>
    </div>
  )
}

/**
 * Workshop Backtest: runs what's on screen (saved or not) against past daily sessions.
 * Results are hypothetical and kept apart from the bot's paper trades.
 */
export default function BacktestPanel({ preview, blockedReason = null }) {
  const [range, setRange] = useState('1Y')
  const [model, setModel] = useState('next_open')
  const [state, setState] = useState({ status: 'idle', run: null, error: null })
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  async function poll(id) {
    for (let i = 0; i < MAX_POLLS && live.current; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      let run
      try { run = await get(`/backtests/${id}`) } catch { continue }
      if (!live.current) return
      if (run?.status === 'succeeded') return setState({ status: 'done', run, error: null })
      if (run?.status === 'failed') return setState({ status: 'error', run, error: run.error || 'The backtest failed.' })
      setState((s) => ({ ...s, status: run?.status === 'running' ? 'running' : 'queued' }))
    }
    if (live.current) setState((s) => ({ ...s, status: 'error', error: 'The backtest is taking longer than expected. Try again in a minute.' }))
  }

  async function start() {
    setState({ status: 'queued', run: null, error: null })
    try {
      const created = await post('/backtests', { config: preview.config, rules: preview.rules, range, executionModel: model })
      await poll(created.id)
    } catch (err) {
      setState({ status: 'error', run: null, error: err?.serverMessage || 'The backtest couldn’t start.' })
    }
  }

  const busy = state.status === 'queued' || state.status === 'running'
  return (
    <section className="tl-backtest" aria-labelledby="backtest-title" data-testid="backtest-panel">
      <div className="tl-backtest-head">
        <div>
          <h2 id="backtest-title" className="tl-backtest-title">Backtest</h2>
          <p className="tl-small tl-muted m0">See how this algorithm would have traded past daily closes. Hypothetical, separate from its paper trades.</p>
        </div>
      </div>
      <div className="tl-backtest-controls">
        <div className="tl-seg" role="group" aria-label="Backtest period">
          {RANGES.map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} disabled={busy}>{r}</button>)}
        </div>
        <div className="tl-seg" role="group" aria-label="Fill model">
          {MODELS.map((m) => <button key={m.id} type="button" aria-pressed={model === m.id} title={m.hint} onClick={() => setModel(m.id)} disabled={busy}>{m.label}</button>)}
        </div>
        <button type="button" className="tl-btn tl-btn--primary tl-btn--sm" onClick={start} disabled={busy || Boolean(blockedReason)} data-testid="run-backtest">
          {busy ? (state.status === 'running' ? 'Running…' : 'Queued…') : state.run ? 'Run again' : 'Run backtest'}
        </button>
      </div>
      <p className="tl-small tl-muted m0">{MODELS.find((m) => m.id === model).hint}</p>
      {blockedReason && <p className="tl-small" data-testid="backtest-blocked">{blockedReason}</p>}
      {state.status === 'error' && <div className="tl-notice tl-notice--error" role="alert" data-testid="backtest-error" style={{ marginTop: 12 }}>{state.error}</div>}
      {busy && <span className="tl-skel" style={{ height: 160, marginTop: 14 }} aria-label="Backtest running" />}
      {state.status === 'done' && state.run && <BacktestResults run={state.run} />}
    </section>
  )
}
