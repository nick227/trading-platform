import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { STATUS_LABELS } from '../../api/services/botDashboardService'
import ActivityFeed from '../../ui/ActivityFeed'
import { describeAction, describeGuards, isResearchBot, needsTriggerPrice } from '../../ui/describeBot'
import { listJoin, money, moneyWhole, plural, ratioPct, sessionDate, signedMoney, tone } from '../../ui/format'
import { loadBotsPage } from './botsApi'

function behaviorTag(f) {
  if (isResearchBot(f.config)) return 'Research-driven'
  const types = new Set(f.rules.map((r) => r.type))
  if (types.has('trend_filter')) return 'Trend following'
  if (types.has('price_threshold')) return f.config.direction === 'sell' ? 'Price trigger · sell' : 'Price trigger · buy'
  if (types.has('daily_loss')) return 'Loss-limited buying'
  return 'Scheduled buying'
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  )
}

// ── Featured bots ───────────────────────────────────────────────────────────

function ResultsSummary({ results }) {
  if (!results) return <><b className="tl-faint">—</b>Results unavailable</>
  if (results.fills === 0) {
    return <><b className="tl-faint">No fills yet</b>{results.runningBots ? `${plural(results.runningBots, 'bot')} running` : 'Not running anywhere yet'}</>
  }
  return (
    <>
      <b className={tone(results.totalPnl)}>{results.totalPnl !== null ? signedMoney(results.totalPnl) : '—'}</b>
      {plural(results.fills, 'fill')} · {plural(results.runningBots, 'bot')} running
    </>
  )
}

function Research({ research }) {
  const h = research.holdout
  const hit = h?.hitRate !== null && h?.hitRate !== undefined ? Number(h.hitRate) : null
  const base = h?.baselineRate !== null && h?.baselineRate !== undefined ? Number(h.baselineRate) : null
  return (
    <div data-testid="featured-research">
      <h4>Research behind it</h4>
      <p className="tl-small" style={{ margin: '0 0 6px' }}>
        Latest verified publication from <strong>{research.model ?? 'Alpha Engine'}</strong>
        {research.horizon ? `, ${research.horizon} horizon` : ''}
        {research.observedAt ? `, observed ${sessionDate(research.observedAt, { year: true })}` : ''}.
      </p>
      {hit !== null && base !== null && (
        <div className="tl-meter">
          <div className="tl-meter-row"><span>Hit rate (holdout)</span><span className="tl-meter-track"><span className="tl-meter-fill tl-meter-fill--accent" style={{ display: 'block', width: `${hit * 100}%` }} /></span><span className="tl-num">{ratioPct(hit)}</span></div>
          <div className="tl-meter-row"><span>Always-up baseline</span><span className="tl-meter-track"><span className="tl-meter-fill" style={{ display: 'block', width: `${base * 100}%` }} /></span><span className="tl-num">{ratioPct(base)}</span></div>
        </div>
      )}
      <p className="tl-small" style={{ margin: '10px 0 0' }}>
        {research.edgeOverBaseline === true ? (
          <span className="tl-verdict tl-verdict--edge">Beat its baseline</span>
        ) : research.edgeOverBaseline === false ? (
          <span className="tl-verdict tl-verdict--noedge">No proven edge — by default this bot won’t trade it</span>
        ) : null}
      </p>
      <p className="tl-small tl-muted" style={{ margin: '6px 0 0' }}>
        {h?.samples ? `${h.samples.toLocaleString()} holdout samples` : 'Holdout size unknown'}
        {h?.start && h?.end ? `, ${sessionDate(h.start, { year: true })} – ${sessionDate(h.end, { year: true })}` : ''}
        {research.genuineOutOfSample === false ? '. Pseudo-out-of-sample: the holdout was already observable when the rule was fixed.' : '.'}
        {research.mode === 'historical_replay' ? ' Historical replay research — separate from the bot results.' : ''}
        {research.verified ? ' Evidence is digest-verified.' : ''}
      </p>
    </div>
  )
}

function FeaturedBot({ f, open, onToggle }) {
  const guards = describeGuards(f, { template: true })
  const r = f.results
  const trigger = needsTriggerPrice(f.rules)
  return (
    <li id={`featured-${f.id}`} data-testid="featured-bot">
      <button type="button" className="tl-featured-row" aria-expanded={open} onClick={onToggle}>
        <span>
          <span className="tl-featured-name"><span>{f.name}</span><Chevron /></span>
          <span className="tl-featured-sentence" style={{ display: 'block' }}>{describeAction(f, { template: true })}</span>
          <span className="tl-tags">
            <span className="tl-tag">{behaviorTag(f)}</span>
            {f.research?.edgeOverBaseline === false && <span className="tl-tag tl-tag--warn">Latest research: no edge</span>}
            {f.research?.edgeOverBaseline === true && <span className="tl-tag">Latest research beat baseline</span>}
            {!f.available && <span className="tl-tag tl-tag--warn">Not available yet</span>}
          </span>
        </span>
        <span className="tl-featured-results"><ResultsSummary results={r} /></span>
      </button>
      {open && (
        <div className="tl-featured-body">
          <div>
            <h4>How it works</h4>
            <ul className="tl-rule-list">
              {guards.map((g) => <li key={g}>{g}</li>)}
              {trigger && <li>You set the trigger price when you create it</li>}
            </ul>
            <p className="tl-small tl-muted" style={{ margin: '10px 0 0' }}>
              You choose the symbols, the simulated capital and the most it can spend per order. Every bot runs under the account’s risk policy.
            </p>
            <div className="tl-detail-actions">
              {f.available ? (
                <Link className="tl-btn tl-btn--primary" to={`/bots/new?template=${encodeURIComponent(f.id)}`}>Use this bot</Link>
              ) : (
                <span className="tl-small tl-muted">Strategy-based bots can’t run in the bot engine yet.</span>
              )}
            </div>
          </div>
          <div>
            <h4>Results so far</h4>
            {!r ? (
              <p className="tl-small tl-muted">Results are unavailable right now.</p>
            ) : r.fills === 0 ? (
              <p className="tl-small tl-muted" style={{ marginTop: 0 }}>
                No fills yet{r.runningBots ? ` — ${plural(r.runningBots, 'bot')} running` : ''}. Results appear after the first simulated fill.
              </p>
            ) : (
              <>
                <dl className="tl-facts" data-testid="featured-results">
                  <dt>P&amp;L at latest close</dt><dd className={tone(r.totalPnl)}>{signedMoney(r.totalPnl)}</dd>
                  <dt>Unrealized · realized</dt><dd>{signedMoney(r.unrealizedPnl)} · {signedMoney(r.realizedPnl)}</dd>
                  <dt>Capital in use</dt><dd>{money(r.capitalInUse)}</dd>
                  <dt>Fills · closed trades</dt><dd>{r.fills} · {r.closedTrades}</dd>
                  <dt>Win rate</dt><dd>{r.winRate !== null ? `${r.winRate.toFixed(0)}% (${r.wins}/${r.closedTrades})` : <span className="tl-muted">Needs 5 closed trades ({r.closedTrades} so far)</span>}</dd>
                  <dt>Bots · people</dt><dd>{r.bots} · {r.users}</dd>
                  <dt>Traded</dt><dd>{listJoin(r.symbols, 4) || '—'}</dd>
                </dl>
                <p className="tl-small tl-muted" style={{ margin: '10px 0 0' }}>
                  {r.fillSource === 'simulator' ? 'Actual simulator fills' : 'Actual paper fills'} from every bot built on this template
                  {r.firstSession ? `, ${r.firstSession === r.lastSession ? sessionDate(r.firstSession) : `${sessionDate(r.firstSession)} – ${sessionDate(r.lastSession)}`}` : ''}
                  {r.pricesAsOf ? `, valued at the ${sessionDate(r.pricesAsOf)} close` : ''}. Small sample — not a forecast.
                </p>
              </>
            )}
            {f.research && <div style={{ marginTop: 22 }}><Research research={f.research} /></div>}
          </div>
        </div>
      )}
    </li>
  )
}

// ── My bots (behavior context) ──────────────────────────────────────────────

function MyBot({ bot }) {
  const pnl = bot.performance?.total ?? null
  return (
    <li className="tl-bot" data-testid="my-bot">
      <Link to={`/bots/${bot.id}`} state={{ from: 'bots', focus: 'behavior' }} className="tl-bot-main">
        <span className="tl-bot-name"><span>{bot.name}</span><span className={`tl-status tl-status--${bot.status}`}>{STATUS_LABELS[bot.status]}</span></span>
        <span className="tl-bot-sentence" style={{ display: 'block' }}>{describeAction(bot)}</span>
        <span className="tl-bot-meta">
          {bot.templateName && <span>From {bot.templateName}</span>}
          <span>{bot.allocation !== null ? `${moneyWhole(bot.allocation)} capital` : 'Capital not set'}{bot.maxPerOrder !== null ? ` · ≤ ${moneyWhole(bot.maxPerOrder)}/order` : ''}</span>
          <span>{plural(bot.fillCount, 'fill')}</span>
        </span>
      </Link>
      <div className="tl-bot-side">
        <div className="tl-bot-figure">
          {pnl !== null ? <b className={tone(pnl)}>{signedMoney(pnl)}</b> : <b className="tl-faint">—</b>}
          <span>{pnl !== null ? 'P&L' : 'No fills yet'}</span>
        </div>
      </div>
    </li>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BotsPage() {
  const location = useLocation()
  const [state, setState] = useState({ loading: true })
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('featured'))

  useEffect(() => {
    let live = true
    loadBotsPage().then((data) => live && setState({ loading: false, data }))
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (state.loading || !open) return
    document.getElementById(`featured-${open}`)?.scrollIntoView?.({ block: 'start' })
  }, [state.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = state.data
  return (
    <main className="tl-page" aria-busy={state.loading}>
      <header className="tl-header">
        <div>
          <h1 className="tl-title">Bots</h1>
          <p className="tl-lede">Bots trade your simulated portfolio by rules you can read. See what each one does and how it has done, then start your own.</p>
        </div>
        <Link to="/bots/new" className="tl-btn tl-btn--primary">Create bot</Link>
      </header>

      {state.loading ? (
        <div aria-hidden="true" data-testid="bots-loading">
          {[0, 1, 2, 3].map((i) => <span key={i} className="tl-skel" style={{ height: 72, marginTop: i ? 12 : 0 }} />)}
        </div>
      ) : (
        <>
          <section className="tl-section" aria-labelledby="featured-title">
            <div className="tl-section-head">
              <h2 className="tl-section-title" id="featured-title">Featured bots</h2>
              <span className="tl-section-aside tl-muted tl-small tl-hide-sm">Results: actual simulated fills, all users</span>
            </div>
            {d.featuredError ? (
              <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{d.featuredError}</div>
            ) : (
              <>
                {d.resultsError && <div className="tl-notice tl-notice--warn" role="status" style={{ marginTop: 16 }}>{d.resultsError}</div>}
                <ul className="tl-list tl-featured">
                  {d.featured.map((f) => <FeaturedBot key={f.id} f={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} />)}
                </ul>
              </>
            )}
          </section>

          <section className="tl-section" id="mine" aria-labelledby="my-bots-title">
            <div className="tl-section-head">
              <h2 className="tl-section-title" id="my-bots-title">My bots{d.myBots.length > 0 && <span className="tl-count">{d.myBots.length}</span>}</h2>
            </div>
            {d.myBotsError ? (
              <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 16 }}>{d.myBotsError}</div>
            ) : d.myBots.length === 0 ? (
              <div className="tl-empty">
                <p><strong>You haven’t created a bot yet.</strong> Open a featured bot above to see its rules and results, then choose “Use this bot”.</p>
              </div>
            ) : (
              <ul className="tl-list">{d.myBots.map((b) => <MyBot key={b.id} bot={b} />)}</ul>
            )}
          </section>

          <section className="tl-section" id="decisions" aria-labelledby="decisions-title">
            <div className="tl-section-head">
              <h2 className="tl-section-title" id="decisions-title">Decision history</h2>
            </div>
            <p className="tl-section-note">Every check your bots make — what they saw, what they decided, and why — through to the order and fill.</p>
            <ActivityFeed items={d.decisions} lens="decisions" limit={10} routine="summary" testId="decision-list" empty={d.myBots.length ? 'No decisions recorded yet.' : 'Decisions appear here once you have a bot running.'} />
          </section>
        </>
      )}
    </main>
  )
}
