import { evidenceLabel } from '../../ui/contentPresentation'
import { PageIdentity, ContentState } from '../../components/content/ContentBlocks'
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
import { strategyPresentation } from './strategyPresentation'
import PersonalAiTraderCard from '../ai/PersonalAiTraderCard'
import './bots-cards.css'

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
      <h4>Research evidence</h4>
      <p className="tl-small m0">
        <strong>{research.model ?? 'Alpha Engine'}</strong>
        {research.horizon ? `, ${research.horizon} horizon` : ''}{research.observedAt ? `, ${sessionDate(research.observedAt, { year: true })}` : ''}.
      </p>
      {gap !== null && (
        <p className="tl-small" style={{ margin: '6px 0 0' }}>
          Correct predictions in a later test {ratioPct(h.hitRate)} vs {ratioPct(h.baselineRate)} always-predict-up comparison <span className={gap >= 0 ? 'tl-pos' : 'tl-neg'}>({gap >= 0 ? '+' : '−'}{Math.abs(gap).toFixed(1)} pts)</span>
        </p>
      )}
      <p className="tl-small" style={{ margin: '6px 0 0' }}>
        {research.edgeOverBaseline === true ? <span className="tl-verdict tl-verdict--edge">Above baseline</span>
          : research.edgeOverBaseline === false ? <span className="tl-verdict tl-verdict--noedge">Did not beat baseline</span> : null}
      </p>
      <p className="tl-small tl-muted" style={{ margin: '6px 0 0' }}>
        {h?.samples ? `${h.samples.toLocaleString()} later-test samples` : 'Later-test sample count unavailable'}
        {h?.start && h?.end ? `, ${sessionDate(h.start, { year: true })} – ${sessionDate(h.end, { year: true })}` : ''}.
        {research.genuineOutOfSample === false ? ' Test separation is not independently verified.' : ''}
        {research.mode === 'historical_replay' ? ' Historical replay research, separate from the results above.' : ''}
        {research.verified ? ' Evidence is digest-verified.' : ''} Research is an input you can test, not a recommendation.
      </p>
    </div>
  )
}

function StartingPoint({ f, open, onToggle, symbolContext = null }) {
  const guards = describeGuards(f, { template: true })
  const presentation = strategyPresentation(f)
  const r = f.results
  const m = resultsMaturity(r)
  const isAi = f.botType === 'strategy_based' || f.config?.signalSource === 'ai_catalyst_momentum'
  const evidenceWindow = isAi ? 'forward' : '5Y'
  const customizeHref = `/bots/new?template=${encodeURIComponent(f.id)}${symbolContext ? `&ticker=${encodeURIComponent(symbolContext)}` : ''}`
  return (
    <li id={`featured-${f.id}`} className="tl-strategy-card" data-testid="featured-bot">
      <button type="button" className="tl-strategy-card__trigger" aria-expanded={open} onClick={onToggle}>
        <span className={`tl-strategy-card__icon ${presentation.isAi ? 'is-ai' : ''}`} aria-hidden="true">
          {presentation.isAi ? '✦' : '↗'}
        </span>
        <span className="tl-strategy-card__copy">
          <span className="tl-strategy-card__title">{presentation.name}</span>
          <span className="tl-strategy-card__description">{presentation.description}</span>
        </span>
        <span className="tl-strategy-card__meta">
          <span className="tl-strategy-card__type">{presentation.isAi ? 'AI-powered' : 'Rule-based'}</span>
          {!f.available && <span className="tl-strategy-card__unavailable">Not available to configure</span>}
          <span className="tl-strategy-card__more">{open ? 'Hide details' : 'View details'} <Chevron open={open} /></span>
        </span>
      </button>
      {open && (
        <div className="tl-featured-body tl-strategy-card__details">
          <div>
            <h4>When it trades</h4>
            <ul className="tl-rule-list">
              {guards.map((g) => <li key={g}>{g}</li>)}
              {needsTriggerPrice(f.rules) && <li>You set the trigger price</li>}
            </ul>
                        <div className="tl-detail-actions tl-action-row">
              {f.available
                ? <Link className="tl-btn tl-btn--secondary" to={customizeHref}>Customize</Link>
                : null}
            </div>
          </div>
          <div>
            <h4>Results</h4>
            <p className="tl-small m0" data-testid="featured-evidence-detail">
              {(isAi ? ['forward'] : ['5Y', '1Y', 'holdout', 'forward']).filter((w) => w !== 'holdout' || f.evidence?.windows?.holdout).map((w) => (
                <span key={w} className="tl-evidence-line">{evidenceLabel(w)}: {summaryLine(f.evidence?.windows?.[w])}</span>
              ))}
            </p>
            <p className="tl-small" style={{ margin: '6px 0 18px' }}>
              Detailed historical research is available separately from bot configuration.
            </p>
            <h4>Results from simulated bot trades</h4>
            
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
  const searchParams = new URLSearchParams(location.search)
  const symbolContext = (searchParams.get('symbol') || searchParams.get('ticker') || '').trim().toUpperCase() || null
  const [state, setState] = useState({ loading: true })
  const [open, setOpen] = useState(() => searchParams.get('featured') || searchParams.get('strategy') || searchParams.get('template'))
  const [personalOpen, setPersonalOpen] = useState(false)
  const [personalStatus, setPersonalStatus] = useState(null)
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
  const createBotHref = `/bots/new${symbolContext ? `?ticker=${encodeURIComponent(symbolContext)}` : ''}`

  return (
    <main className="tl-page tl-bots-page" aria-busy={state.loading}>
      <EmergencyBanner stop={stop} onClear={clear} />
      <div className="tl-bots-page__header">
        <h1>My Bots</h1>
        <Link to={createBotHref} className="tl-btn tl-btn--primary">Add bot</Link>
      </div>
      {state.loading ? (
        <div aria-hidden="true" data-testid="bots-loading">
          {[0, 1, 2, 3].map((i) => <span key={i} className="tl-skel" style={{ height: 72, marginTop: i ? 12 : 0 }} />)}
        </div>
      ) : (
        <>
          {(hasBots || d.myBotsError) && (
            <section className="tl-bots-page__section" id="mine" aria-labelledby="my-bots-title">
              <div className="tl-section-head">
                <h2 className="tl-section-title" id="my-bots-title">My bots<span className="tl-count">{d.myBots.length}</span></h2>
              </div>
              {d.myBotsError
                ? <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{d.myBotsError}</div>
                : <ul className="tl-list tl-machine-list">{d.myBots.map((b) => <BotRow key={b.id} bot={b} busy={Boolean(controls.busy[b.id])} error={controls.errors[b.id]} onToggle={controls.toggle} from="bots" />)}</ul>}
              {!d.myBotsError && d.myBots.length > 1 && (
                <details className="tl-flow-card" style={{ marginTop: 18 }} data-testid="bots-compare-disclosure">
                  <summary><strong>Inspect details · Side-by-side bot comparison</strong></summary>
                  <div style={{ marginTop: 12 }}><CompareBots /></div>
                </details>
              )}
            </section>
          )}

          <section className="tl-bots-page__section" aria-labelledby="featured-title">
            <div className="tl-section-head">
              <h2 className="tl-section-title" id="featured-title">Available strategies</h2>
              
            </div>
            {d.featuredError ? (
              <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{d.featuredError}</div>
            ) : (
              <>

                {d.featured.length === 0 && <ContentState title="No starter strategies available" description="There are no published strategies to customize right now." />}
                <ul className="tl-strategy-grid">
                  {d.featured.map((f) => <StartingPoint key={f.id} f={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} symbolContext={symbolContext} />)}
                  <li className="tl-strategy-card" data-testid="personal-ai-strategy">
                    <button type="button" className="tl-strategy-card__trigger" aria-expanded={personalOpen} onClick={() => setPersonalOpen(value => !value)}>
                      <span className="tl-strategy-card__icon is-ai" aria-hidden="true">✦</span>
                      <span className="tl-strategy-card__copy">
                        <span className="tl-strategy-card__title">Personal AI Stock Trader</span>
                        <span className="tl-strategy-card__description">Researches stocks based on your preferred sectors, risk settings, and trade approval preferences.</span>
                      </span>
                      <span className="tl-strategy-card__meta">
                        <span className="tl-strategy-card__type">AI-powered</span>
                        {personalStatus?.status === 'unavailable' && <span className="tl-strategy-card__unavailable">Currently unavailable</span>}
                        <span className="tl-strategy-card__more">{personalOpen ? 'Hide details' : 'View details'} <Chevron open={personalOpen} /></span>
                      </span>
                    </button>
                    {personalOpen && <div className="tl-strategy-card__details">
                      <PersonalAiTraderCard onStatusChange={setPersonalStatus} />
                      {personalStatus?.status === 'unavailable' &&
                        <p className="tl-small tl-muted">Personal AI Trader settings are temporarily unavailable.</p>}
                    </div>}
                  </li>
                </ul>
              </>
            )}
          </section>

          {hasBots && (
            <section className="tl-bots-page__section" id="activity" aria-labelledby="activity-title">
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
