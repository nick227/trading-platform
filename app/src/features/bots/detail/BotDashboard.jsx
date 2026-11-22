import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Sheet from '../../../components/Sheet'
import { collapseRoutine, FeedIcon, ResearchEvidence } from '../../../ui/ActivityFeed'
import { describeAction, describeGuards, isResearchBot } from '../../../ui/describeBot'
import { sessionDate } from '../../../ui/format'
import {
  controlErrorMessage,
  deriveStatus,
  STATUS_LABELS,
  loadBotActivity,
  loadBotDashboard,
  loadBotRules,
  pauseBot,
  resumeBot,
  stopBot,
  summarizeFills,
  toNumberOrNull,
  updateBotSettings,
} from '../../../api/services/botDashboardService'

export const REFRESH_MS = 30_000
const ROUTINE_CATS = new Set(['evaluation', 'skip'])
const PAGE = 15

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const fmtMoney = (n) => (n === null || n === undefined ? '—' : money.format(n))
const fmtSigned = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${money.format(Math.abs(n))}`)
const tone = (n) => (n > 0 ? 'tl-pos' : n < 0 ? 'tl-neg' : '')
const pct = (v) => (v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`)

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function describeDirection(direction) {
  if (direction === 'buy') return 'Buys only'
  if (direction === 'sell') return 'Sells only'
  if (direction === 'both') return 'Buys and sells'
  return null
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Performance({ bot, fills, executionsAvailable }) {
  const p = bot.performance
  return (
    <section className="tl-section" id="impact" aria-labelledby="perf-title">
      <div className="tl-section-head"><h2 className="tl-section-title" id="perf-title">Performance</h2></div>
      {p ? (
        <dl className="tl-stats" data-testid="performance" style={{ borderTop: 0 }}>
          <div className="tl-stat">
            <dt>Total P&amp;L</dt>
            <dd className={tone(p.total)}>{p.total !== null ? fmtSigned(p.total) : '—'}{p.total === null && <small>Waiting for a price</small>}</dd>
          </div>
          <div className="tl-stat">
            <dt>Unrealized</dt>
            {p.unrealized !== null ? <dd className={tone(p.unrealized)}>{fmtSigned(p.unrealized)}</dd> : <dd className="tl-muted" data-testid="unrealized-unavailable">Not available yet</dd>}
          </div>
          <div className="tl-stat"><dt>Realized</dt><dd className={tone(p.realized)}>{fmtSigned(p.realized)}{p.fees ? <small>{fmtMoney(p.fees)} fees</small> : null}</dd></div>
          <div className="tl-stat">
            <dt>Capital in use</dt>
            {bot.capitalInUse !== null ? <dd data-testid="capital-in-use">{fmtMoney(bot.capitalInUse)}<small>of <span data-testid="capital-allocation">{bot.allocation !== null ? fmtMoney(bot.allocation) : 'no set capital'}</span></small></dd> : <dd className="tl-muted" data-testid="capital-in-use">Not available yet<small>of <span data-testid="capital-allocation">{bot.allocation !== null ? fmtMoney(bot.allocation) : 'no set capital'}</span></small></dd>}
          </div>
        </dl>
      ) : (
        <div className="tl-empty">
          <p data-testid="performance-unavailable">No P&amp;L yet — it appears after this bot’s first fill.</p>
          <p className="tl-small tl-muted">Capital <span data-testid="capital-allocation">{bot.allocation !== null ? fmtMoney(bot.allocation) : 'not set'}</span> · in use <span data-testid="capital-in-use">{bot.capitalInUse !== null ? fmtMoney(bot.capitalInUse) : 'Not available yet'}</span></p>
        </div>
      )}
      <p className="tl-section-note">
        {fills && executionsAvailable && <span data-testid="fill-summary">{fills.filledOrders} filled {fills.filledOrders === 1 ? 'order' : 'orders'}{fills.costs > 0 && <> · {fmtMoney(fills.costs)} in fees and commissions</>}. </span>}
        {p?.valuation?.simulated && <span data-testid="performance-valuation">Open positions valued at the {[...new Set(Object.values(p.valuation.sessions ?? {}))].map((s) => sessionDate(s)).join(', ')} close (simulated). </span>}
        Capital isn’t set aside — it caps what this bot may spend.
      </p>
    </section>
  )
}

function Holdings({ bot }) {
  const positions = Object.values(bot.openPositions ?? {})
  if (positions.length === 0) return null
  return (
    <section className="tl-section" aria-labelledby="holdings-title">
      <div className="tl-section-head"><h2 className="tl-section-title" id="holdings-title">Holdings</h2></div>
      <table className="tl-table" data-testid="bot-holdings-table">
        <thead><tr><th>Symbol</th><th className="r">Shares</th><th className="r tl-hide-sm">Avg cost</th><th className="r">Last close</th><th className="r">Return</th></tr></thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.ticker}>
              <td><Link className="tl-sym" to={`/?holding=${encodeURIComponent(p.ticker)}`}>{p.ticker}</Link></td>
              <td className="r">{p.quantity}</td>
              <td className="r tl-hide-sm">{fmtMoney(p.avgPrice)}</td>
              <td className="r">{fmtMoney(p.currentPrice)}</td>
              <td className={`r ${tone(p.unrealizedPnl)}`}>{fmtSigned(p.unrealizedPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Behavior({ bot, onEdit, editable }) {
  const guards = describeGuards(bot)
  return (
    <section className="tl-section" id="behavior" aria-labelledby="behavior-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="behavior-title">How it works</h2>
        {editable && <button type="button" className="tl-link-btn" onClick={onEdit}>Edit limits</button>}
      </div>
      <p style={{ margin: '14px 0 6px', fontSize: 15.5 }}>{describeAction(bot)}</p>
      <ul className="tl-rule-list">{guards.map((g) => <li key={g}>{g}</li>)}</ul>
    </section>
  )
}

function Diagnostics({ data }) {
  const entries = Object.entries(data ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (entries.length === 0) return null
  return (
    <details className="tl-evidence tl-evidence--quiet">
      <summary>Details</summary>
      <div className="tl-evidence-body">
        <dl>
          {entries.map(([k, v]) => (
            <Fragment key={k}><dt>{k}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></Fragment>
          ))}
        </dl>
      </div>
    </details>
  )
}

function ResearchSummary({ research }) {
  if (!research) return null
  const h = research.holdout
  return (
    <p className="tl-feed-text tl-muted" data-testid="research-summary">
      {research.direction} · {research.horizon} · observed {research.observedAt ? sessionDate(research.observedAt) : '—'}{research.mode === 'historical_replay' ? ' · historical replay' : ''}
      {' '}· score {research.score ?? '—'} <span>(not a probability)</span>
      {h && <> · holdout {pct(h.precision)} vs {pct(h.baselineRate)} baseline ({h.signals} signals) — {research.edgeOverBaseline ? 'beat the baseline' : 'no edge over the baseline'}</>}
      {research.genuineOutOfSample === false && <> · pseudo-out-of-sample</>}
    </p>
  )
}

function Timeline({ activity, status, onRetry, research }) {
  const [shown, setShown] = useState(PAGE)
  const { timeline, eventsAvailable, executionsAvailable } = activity

  if (!eventsAvailable && !executionsAvailable) {
    return (
      <div className="tl-notice tl-notice--warn" role="status" data-testid="activity-unavailable" style={{ marginTop: 14 }}>
        Activity is unavailable right now. <button type="button" className="tl-link-btn" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  const items = collapseRoutine(timeline)
  return (
    <>
      {!eventsAvailable && <p className="tl-section-note" data-testid="events-unavailable">The bot’s decision log is unavailable right now, so only orders are shown.</p>}
      {!executionsAvailable && <p className="tl-section-note" data-testid="orders-unavailable">Order history is unavailable right now, so only decisions are shown.</p>}
      {items.length === 0 ? (
        <p className="tl-feed-empty" data-testid="activity-empty">
          No activity yet.{' '}
          {status === 'paused' ? 'Resume the bot to start it.' : status === 'stopped' ? '' : 'Checks and paper orders will appear here as the bot runs.'}
        </p>
      ) : (
        <ol className="tl-feed" data-testid="timeline">
          {items.slice(0, shown).map((item) => (
            <li key={item.id} className={`tl-feed-item timeline-item--${item.category} ${ROUTINE_CATS.has(item.category) ? 'tl-feed-item--routine' : ''}`} title={ROUTINE_CATS.has(item.category) ? item.explanation : undefined}>
              <FeedIcon item={item} />
              <div>
                <div className="tl-feed-title timeline-title">
                  {item.title}
                  {item.symbol && !item.title.includes(item.symbol) && <> · {item.symbol}</>}
                  {item.count > 1 && <span className="tl-feed-repeat">×{item.count}<span className="tl-visually-hidden"> Repeated {item.count} times since {fmtWhen(item.since)}</span></span>}
                </div>
                {item.explanation && !ROUTINE_CATS.has(item.category) && <p className="tl-feed-text">{item.explanation}</p>}
                <ResearchSummary research={item.research} />
                {item.executionId && research && (item.category === 'fill' || item.category === 'order') && <ResearchEvidence executionId={item.executionId} />}
                {!ROUTINE_CATS.has(item.category) && <Diagnostics data={item.diagnostics} />}
              </div>
              <time className="tl-feed-time" dateTime={item.at ?? undefined}>{fmtWhen(item.at)}</time>
            </li>
          ))}
        </ol>
      )}
      {items.length > shown && (
        <button type="button" className="tl-btn tl-btn--sm tl-feed-more" onClick={() => setShown((n) => n + PAGE)}>Show older activity</button>
      )}
    </>
  )
}

function AdvancedDetails({ bot }) {
  const [rules, setRules] = useState(undefined) // undefined = not loaded, null = unavailable
  const onToggle = (e) => {
    if (e.currentTarget.open && rules === undefined) loadBotRules(bot.id).then(setRules)
  }
  return (
    <details className="tl-evidence tl-section" onToggle={onToggle}>
      <summary>Strategy and technical details</summary>
      <div className="tl-evidence-body">
      <dl>
        <dt>Template</dt><dd>{bot.strategyName ?? bot.templateId ?? 'Custom'}</dd>
        <dt>Type</dt><dd>{bot.botType === 'strategy_based' ? 'Strategy bot' : 'Rule bot'}</dd>
        <dt>Bot ID</dt><dd>{bot.id}</dd>
        <dt>Created</dt><dd>{fmtWhen(bot.createdAt) || '—'}</dd>
      </dl>
      <h4 style={{ margin: '14px 0 6px' }}>Rules</h4>
      {rules === undefined ? (
        <p className="muted text-sm">Loading…</p>
      ) : rules === null ? (
        <p className="muted text-sm">Rules are unavailable right now.</p>
      ) : rules.length === 0 ? (
        <p className="muted text-sm">This bot has no saved rules.</p>
      ) : (
        <ul className="text-sm" data-testid="rules-list">
          {rules.map((r) => <li key={r.id}>{r.name ?? r.type} {r.enabled === false && <span className="muted">(off)</span>}</li>)}
        </ul>
      )}
      <h4 style={{ margin: '14px 0 6px' }}>Configuration</h4>
      <pre className="bot-config" style={{ fontSize: 12, overflowX: 'auto', margin: 0 }}>{JSON.stringify(bot.config, null, 2)}</pre>
      </div>
    </details>
  )
}

function EditSheet({ bot, onClose, onSaved }) {
  const [name, setName] = useState(bot.name)
  const [allocation, setAllocation] = useState(bot.allocation !== null ? String(bot.allocation) : '')
  const [maxPerOrder, setMaxPerOrder] = useState(bot.maxPerOrder !== null ? String(bot.maxPerOrder) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  const cap = toNumberOrNull(allocation)
  const max = toNumberOrNull(maxPerOrder)
  const errors = {}
  if (!name.trim()) errors.name = 'Give your bot a name.'
  if (cap === null || cap <= 0) errors.allocation = 'Enter an amount greater than $0.'
  if (max === null || max <= 0) errors.maxPerOrder = 'Enter an amount greater than $0.'
  else if (cap !== null && max > cap) errors.maxPerOrder = 'Can’t be more than the simulated capital.'

  const save = async () => {
    setSubmitted(true)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setError(null)
    try {
      await updateBotSettings(bot, { name: name.trim(), allocation: cap, maxPerOrder: max })
      onSaved({ name: name.trim(), allocation: cap, maxPerOrder: max })
    } catch (e) {
      setError(controlErrorMessage(e, 'edit'))
      setSaving(false)
    }
  }

  return (
    <Sheet
      title="Edit bot"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tl-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="tl-btn tl-btn--primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <label className="tl-label" htmlFor="edit-name">Name</label>
      <input id="edit-name" className="tl-input" value={name} onChange={(e) => setName(e.target.value)} />
      {submitted && errors.name && <div className="tl-field-error" role="alert">{errors.name}</div>}

      <label className="tl-label" style={{ display: 'block', marginTop: 16 }} htmlFor="edit-allocation">Simulated capital ($)</label>
      <input id="edit-allocation" className="tl-input" inputMode="decimal" value={allocation} onChange={(e) => setAllocation(e.target.value.replace(/[^0-9.]/g, ''))} />
      {submitted && errors.allocation && <div className="tl-field-error" role="alert">{errors.allocation}</div>}

      <label className="tl-label" style={{ display: 'block', marginTop: 16 }} htmlFor="edit-max">Max per buy order ($)</label>
      <input id="edit-max" className="tl-input" inputMode="decimal" value={maxPerOrder} onChange={(e) => setMaxPerOrder(e.target.value.replace(/[^0-9.]/g, ''))} />
      {submitted && errors.maxPerOrder && <div className="tl-field-error" role="alert">{errors.maxPerOrder}</div>}

      <p className="tl-help" style={{ marginTop: 14 }}>Changes apply to the bot’s next orders.</p>
      {error && <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Sheet>
  )
}

function StopSheet({ bot, onClose, onStopped }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await stopBot(bot.id)
      onStopped()
    } catch (e) {
      setError(controlErrorMessage(e, 'stop'))
      setBusy(false)
    }
  }
  return (
    <Sheet
      title={`Stop ${bot.name}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tl-btn" onClick={onClose} disabled={busy}>Keep bot</button>
          <button type="button" className="tl-btn tl-btn--danger" onClick={confirm} disabled={busy}>{busy ? 'Stopping…' : 'Stop bot'}</button>
        </>
      }
    >
      <p className="m-0">The bot stops for good and won’t place new orders. Its history stays here.</p>
      <p className="tl-help" style={{ marginTop: 8 }}>It doesn’t cancel orders already sent or sell what it bought. If you only want a break, pause it instead.</p>
      {error && <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Sheet>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BotDashboard() {
  const { botId } = useParams()
  const location = useLocation()
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)
  const [controlError, setControlError] = useState(null)
  const [sheet, setSheet] = useState(null) // 'edit' | 'stop' | null
  const [notice, setNotice] = useState(location.state?.created ? 'Your bot was created. You can pause it anytime.' : null)

  useEffect(() => {
    if (!state.loading && location.state?.focus === 'behavior') document.getElementById('behavior')?.scrollIntoView?.({ block: 'start' })
  }, [state.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const result = await loadBotDashboard(botId)
    setState({ loading: false, ...result })
  }, [botId])

  useEffect(() => {
    setState({ loading: true })
    load()
  }, [load])

  const refreshActivity = useCallback(async () => {
    const activity = await loadBotActivity(botId)
    setState((s) => (s.bot ? { ...s, activity, status: deriveStatus(s.bot, activity.timeline), fills: summarizeFills(activity.executions) } : s))
  }, [botId])

  const running = state.bot && !state.bot.stopped && state.bot.enabled
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(refreshActivity, REFRESH_MS)
    return () => clearInterval(t)
  }, [running, refreshActivity])

  const patchBot = (patch) =>
    setState((s) => {
      const bot = { ...s.bot, ...patch }
      return { ...s, bot, status: deriveStatus(bot, s.activity.timeline) }
    })

  const toggle = async () => {
    const action = state.bot.enabled ? 'pause' : 'resume'
    setBusy(true)
    setControlError(null)
    setNotice(null)
    try {
      await (action === 'pause' ? pauseBot(botId) : resumeBot(botId))
      patchBot({ enabled: action === 'resume' })
      setNotice(action === 'pause' ? 'Paused. The bot won’t place new orders until you resume it.' : 'Resumed. The bot is running in paper trading.')
    } catch (e) {
      setControlError(controlErrorMessage(e, action))
    } finally {
      setBusy(false)
    }
  }

  if (state.loading) {
    return (
      <main className="tl-page" aria-busy="true">
        <div data-testid="bot-loading" aria-hidden="true">
          <span className="tl-skel" style={{ width: 90, height: 14 }} />
          <span className="tl-skel" style={{ width: 300, height: 34, marginTop: 18 }} />
          <span className="tl-skel" style={{ height: 76, marginTop: 28 }} />
          <span className="tl-skel" style={{ height: 220, marginTop: 40 }} />
        </div>
      </main>
    )
  }

  const back = location.state?.from === 'bots' ? { to: '/bots', label: 'Bots' } : { to: '/', label: 'Home' }

  if (!state.bot) {
    return (
      <main className="tl-page">
        <Link to={back.to} className="tl-back">← {back.label}</Link>
        <h1 className="tl-title">{state.notFound ? 'Bot not found' : 'Bot unavailable'}</h1>
        <p className="tl-lede">{state.notFound ? 'This bot doesn’t exist or isn’t yours.' : state.error}</p>
        <div className="tl-detail-actions">
          {!state.notFound && <button type="button" className="tl-btn tl-btn--primary" onClick={() => { setState({ loading: true }); load() }}>Retry</button>}
          <Link to="/bots" className="tl-btn">Go to Bots</Link>
        </div>
      </main>
    )
  }

  const { bot, status, activity, fills } = state
  const latestError = status === 'error' ? activity.timeline[0] : null
  const direction = describeDirection(bot.direction)
  const research = isResearchBot(bot.config)

  return (
    <main className="tl-page">
      <Link to={back.to} className="tl-back">← {back.label}</Link>

      <header className="tl-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="tl-title">{bot.name}</h1>
            <span className={`tl-status tl-status--${status}`} data-testid="bot-status">{STATUS_LABELS[status] ?? status}</span>
          </div>
          <p className="tl-lede">
            {research ? 'Research-driven' : 'Rule-based'} · {bot.tickers.length > 0 ? bot.tickers.join(', ') : 'no symbols'}{direction ? ` · ${direction}` : ''}
          </p>
        </div>
        {!bot.stopped && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={`tl-btn ${bot.enabled ? '' : 'tl-btn--primary'}`} onClick={toggle} disabled={busy} style={{ minWidth: 88 }}>
              {busy ? 'Saving…' : bot.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className="tl-btn" onClick={() => setSheet('edit')} disabled={busy}>Edit</button>
            <button type="button" className="tl-btn tl-btn--quiet tl-btn--danger" onClick={() => setSheet('stop')} disabled={busy}>Stop</button>
          </div>
        )}
      </header>

      {bot.stopped && <div className="tl-notice">This bot is stopped and won’t place new orders. Its history stays here. <Link to="/bots/new">Create a new bot</Link></div>}
      {controlError && <div className="tl-notice tl-notice--error" role="alert">{controlError}</div>}
      {notice && !controlError && <div className="tl-notice tl-notice--success" role="status">{notice}</div>}
      {latestError && (
        <div className="tl-notice tl-notice--warn" role="status" data-testid="error-banner">
          <span><strong>{latestError.title}.</strong> {latestError.explanation} {bot.enabled && 'The bot is still on; you can pause it while this is investigated.'}</span>
        </div>
      )}

      <Performance bot={bot} fills={fills} executionsAvailable={activity.executionsAvailable} />
      <Holdings bot={bot} />
      <Behavior bot={bot} editable={!bot.stopped} onEdit={() => setSheet('edit')} />

      <section className="tl-section" aria-labelledby="activity-title">
        <div className="tl-section-head">
          <h2 className="tl-section-title" id="activity-title">Activity</h2>
          <button type="button" className="tl-link-btn" onClick={refreshActivity}>Refresh</button>
        </div>
        <Timeline activity={activity} status={status} onRetry={refreshActivity} research={research} />
      </section>

      <AdvancedDetails bot={bot} />

      {sheet === 'edit' && (
        <EditSheet
          bot={bot}
          onClose={() => setSheet(null)}
          onSaved={(saved) => {
            patchBot({
              name: saved.name,
              allocation: saved.allocation,
              maxPerOrder: saved.maxPerOrder,
              config: { ...bot.config, capitalMode: 'allocated', allocatedAmount: saved.allocation, maxOrderNotional: saved.maxPerOrder },
            })
            setSheet(null)
            setNotice('Changes saved.')
          }}
        />
      )}
      {sheet === 'stop' && (
        <StopSheet
          bot={bot}
          onClose={() => setSheet(null)}
          onStopped={() => {
            patchBot({ stopped: true, enabled: false })
            setSheet(null)
            setNotice('Stopped. The bot won’t place new orders.')
          }}
        />
      )}
    </main>
  )
}
