import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ActivityFeed from '../../ui/ActivityFeed'
import { Chevron } from '../../ui/Disclosure'
import BotRow from '../../ui/BotRow'
import AlgorithmIdentity from '../../ui/AlgorithmIdentity'
import { describeAction, describeGuards, isResearchBot, needsTriggerPrice } from '../../ui/describeBot'
import { EmergencyBanner, useEmergencyStop } from '../../ui/Safety'
import { useBotControls } from '../../ui/useBotControls'
import { listJoin, money, plural, ratioPct, sessionDate, signedMoney } from '../../ui/format'
import { loadBotsPage } from './botsApi'
import CompareBots from './compare/CompareBots'
import { summaryLine } from '../strategies/strategiesApi'

// Below these, results are an anecdote, not evidence.
export const MIN_CLOSED_TRADES = 5
export const MIN_SESSIONS = 5

function behaviorTag(f) {
  if (isResearchBot(f.config)) return 'Research signal'
  const types = new Set(f.rules.map((r) => r.type))
  if (types.has('trend_filter')) return 'Trend'
  if (types.has('price_threshold')) return f.config.direction === 'sell' ? 'Price trigger · sell' : 'Price trigger · buy'
  if (types.has('daily_loss')) return 'Loss-limited buying'
  return 'Schedule'
}

/** Whether a template's results are enough to judge. Never a performance claim otherwise. */
export function resultsMaturity(r) {
  if (!r || r.fills === 0) return 'none'
  const sessions = r.firstSession && r.lastSession ? Math.round((Date.parse(r.lastSession) - Date.parse(r.firstSession)) / 86_400_000) + 1 : 1
  return r.closedTrades >= MIN_CLOSED_TRADES && sessions >= MIN_SESSIONS ? 'judgeable' : 'early'
}

function period(r) {
  if (!r.firstSession) return ''
  return r.firstSession === r.lastSession ? `on ${sessionDate(r.firstSession)}` : `${sessionDate(r.firstSession)} – ${sessionDate(r.lastSession)}`
}


function Research({ research }) {
  const h = research.holdout
  const gap = h?.hitRate !== null && h?.hitRate !== undefined && h?.baselineRate !== null && h?.baselineRate !== undefined ? (h.hitRate - h.baselineRate) * 100 : null
  return (
    <div data-testid="featured-research">
      <h4>Research</h4>
      <p className="tl-small m0">
        <strong>{research.model ?? 'Alpha Engine'}</strong>
        {research.horizon ? `, ${research.horizon} horizon` : ''}{research.observedAt ? `, ${sessionDate(research.observedAt, { year: true })}` : ''}.
      </p>
      {gap !== null && (
        <p className="tl-small" style={{ margin: '6px 0 0' }}>
          Holdout hit rate {ratioPct(h.hitRate)} vs {ratioPct(h.baselineRate)} always-up baseline <span className={gap >= 0 ? 'tl-pos' : 'tl-neg'}>({gap >= 0 ? '+' : '−'}{Math.abs(gap).toFixed(1)} pts)</span>
        </p>
      )}
      <p className="tl-small" style={{ margin: '6px 0 0' }}>
        {research.edgeOverBaseline === true ? <span className="tl-verdict tl-verdict--edge">Above baseline</span>
          : research.edgeOverBaseline === false ? <span className="tl-verdict tl-verdict--noedge">Did not beat baseline</span> : null}
      </p>
      <p className="tl-small tl-muted" style={{ margin: '6px 0 0' }}>
        {h?.samples ? `${h.samples.toLocaleString()} holdout samples` : 'Holdout size unknown'}
        {h?.start && h?.end ? `, ${sessionDate(h.start, { year: true })} – ${sessionDate(h.end, { year: true })}` : ''}.
        {research.genuineOutOfSample === false ? ' Pseudo-out-of-sample.' : ''}
        {research.mode === 'historical_replay' ? ' Historical replay research, separate from the results above.' : ''}
        {research.verified ? ' Evidence is digest-verified.' : ''} Research is an input you can test, not a recommendation.
      </p>
    </div>
  )
}

function StartingPoint({ f, open, onToggle }) {
  const guards = describeGuards(f, { template: true })
  const r = f.results
  const m = resultsMaturity(r)
  const isAi = f.botType === 'strategy_based' || f.config?.signalSource === 'ai_catalyst_momentum'
  const evidenceWindow = isAi ? 'forward' : '5Y'
  return (
    <li id={`featured-${f.id}`} data-testid="featured-bot">
      <button type="button" className="tl-featured-row" aria-expanded={open} onClick={onToggle}>
        <span>
          <span className="tl-featured-name"><AlgorithmIdentity bot={f} compact /><span>{f.name}</span><Chevron open={open} /></span>
          <span className="tl-featured-sentence" style={{ display: 'block' }}>{describeAction(f, { template: true })}</span>
          <span className="tl-tags">
            <span className="tl-tag">{behaviorTag(f)}</span>
            {f.research?.edgeOverBaseline === false && <span className="tl-tag tl-tag--warn">Did not beat baseline</span>}
            {!f.available && <span className="tl-tag tl-tag--warn">{isAi ? 'Workshop unavailable' : 'Not available yet'}</span>}
          </span>
        </span>
        <span className="tl-featured-results" data-testid="featured-evidence">
          <b>{summaryLine(f.evidence?.windows?.[evidenceWindow])}</b>
          {isAi ? 'Forward paper' : f.evidence?.windows?.['5Y']?.status === 'ok' ? `Backtest · 5 years · ${f.evidence.windows['5Y'].symbolsTested} symbols` : 'Backtest'}
        </span>
      </button>
      {open && (
        <div className="tl-featured-body">
          <div>
            <h4>Conditions</h4>
            <ul className="tl-rule-list">
              {guards.map((g) => <li key={g}>{g}</li>)}
              {needsTriggerPrice(f.rules) && <li>You set the trigger price</li>}
            </ul>
                        <div className="tl-detail-actions tl-action-row">
              {f.available
                ? <Link className="tl-btn tl-btn--secondary" to={`/bots/new?template=${encodeURIComponent(f.id)}`}>Customize</Link>
                : null}
            </div>
          </div>
          <div>
            <h4>Results</h4>
            <p className="tl-small m0" data-testid="featured-evidence-detail">
              {(isAi ? ['forward'] : ['5Y', '1Y', 'holdout', 'forward']).filter((w) => w !== 'holdout' || f.evidence?.windows?.holdout).map((w) => (
                <span key={w} className="tl-evidence-line">{{ '5Y': '5 years', '1Y': 'Last year', holdout: 'Holdout', forward: isAi ? 'Since published' : 'Forward paper' }[w]}: {summaryLine(f.evidence?.windows?.[w])}</span>
              ))}
            </p>
            <p className="tl-small" style={{ margin: '6px 0 18px' }}>
              <Link to={`/strategies/${encodeURIComponent(f.id)}`}>Results and methodology →</Link>
            </p>
            <h4>Bot results · Paper</h4>
            
            {!r ? (
              <p className="tl-small tl-muted m0">Results are unavailable right now.</p>
            ) : m === 'none' ? (
              <p className="tl-small tl-muted m0">No simulated trades yet{r.runningBots ? ` — ${plural(r.runningBots, 'bot')} running` : ''}.</p>
            ) : m === 'early' ? (
              <p className="tl-small m0" data-testid="featured-results">
                <strong>Too early to judge.</strong> {plural(r.fills, 'simulated fill')} from {plural(r.bots, 'bot')} {period(r)}, {plural(r.closedTrades, 'closed trade')}
                {r.totalPnl !== null ? ` (${signedMoney(r.totalPnl)} at the ${sessionDate(r.pricesAsOf)} close)` : ''}. At least {MIN_CLOSED_TRADES} closed trades across {MIN_SESSIONS} sessions required.
              </p>
            ) : (
              <>
                <dl className="tl-facts" data-testid="featured-results">
                  <dt>P&amp;L at latest close</dt><dd>{signedMoney(r.totalPnl)}</dd>
                  <dt>Realized</dt><dd>{signedMoney(r.realizedPnl)}</dd>
                  <dt>Closed trades · win rate</dt><dd>{r.closedTrades} · {r.winRate !== null ? `${r.winRate.toFixed(0)}%` : '—'}</dd>
                  <dt>Capital in use</dt><dd>{money(r.capitalInUse)}</dd>
                  <dt>Bots</dt><dd>{r.bots}</dd>
                  <dt>Traded</dt><dd>{listJoin(r.symbols, 4) || '—'}</dd>
                </dl>
                <p className="tl-small tl-muted" style={{ margin: '8px 0 0' }}>Simulated fills · {period(r)}. Results vary by bot settings.</p>
              </>
            )}
            {f.research && <div style={{ marginTop: 20 }}><Research research={f.research} /></div>}
          </div>
        </div>
      )}
    </li>
  )
}

export default function BotsPage() {
  const location = useLocation()
  const [state, setState] = useState({ loading: true })
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('featured'))
  const { stop, clear } = useEmergencyStop()
  const controls = useBotControls((fn) => setState((s) => ({ ...s, data: { ...s.data, myBots: fn(s.data.myBots) } })))

  useEffect(() => {
    let live = true
    loadBotsPage().then((data) => live && setState({ loading: false, data }))
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (state.loading) return
    const id = open ? `featured-${open}` : location.hash.replace('#', '')
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' })
  }, [state.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = state.data
  const hasBots = d?.myBots?.length > 0
  return (
    <main className="tl-page" aria-busy={state.loading}>
      <EmergencyBanner stop={stop} onClear={clear} />
      <header className="tl-header">
        <div>
          <h1 className="tl-title">Bots</h1>
            </div>
        <Link to="/bots/new" className="tl-btn tl-btn--primary">Create bot</Link>
      </header>

      {state.loading ? (
        <div aria-hidden="true" data-testid="bots-loading">
          {[0, 1, 2, 3].map((i) => <span key={i} className="tl-skel" style={{ height: 72, marginTop: i ? 12 : 0 }} />)}
        </div>
      ) : (
        <>
          {(hasBots || d.myBotsError) && (
            <section className="tl-section" id="mine" aria-labelledby="my-bots-title">
              <div className="tl-section-head">
                <h2 className="tl-section-title" id="my-bots-title">My bots<span className="tl-count">{d.myBots.length}</span></h2>
              </div>
              {d.myBotsError
                ? <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{d.myBotsError}</div>
                : <ul className="tl-list tl-machine-list">{d.myBots.map((b) => <BotRow key={b.id} bot={b} busy={Boolean(controls.busy[b.id])} error={controls.errors[b.id]} onToggle={controls.toggle} from="bots" />)}</ul>}
              {!d.myBotsError && d.myBots.length > 1 && <div style={{ marginTop: 18 }}><CompareBots /></div>}
            </section>
          )}

          <section className="tl-section" aria-labelledby="featured-title">
            <div className="tl-section-head">
              <h2 className="tl-section-title" id="featured-title">Starting points</h2>
              
            </div>
            {d.featuredError ? (
              <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{d.featuredError}</div>
            ) : (
              <>
                {d.resultsError && <div className="tl-notice tl-notice--warn" role="status" style={{ marginTop: 16 }}>{d.resultsError}</div>}
                <ul className="tl-list tl-featured">
                  {d.featured.map((f) => <StartingPoint key={f.id} f={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} />)}
                </ul>
              </>
            )}
          </section>

          {hasBots && (
            <section className="tl-section" id="activity" aria-labelledby="activity-title">
              <div className="tl-section-head">
                <h2 className="tl-section-title" id="activity-title">Activity</h2>
              </div>
              <ActivityFeed items={d.decisions} limit={12} routine="summary" testId="decision-list" empty="Nothing has happened yet." />
            </section>
          )}
        </>
      )}
    </main>
  )
}
