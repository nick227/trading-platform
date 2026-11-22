import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { del, get, post, put } from '../../../api/client'
import Sheet from '../../../components/Sheet'
import {
  controlErrorMessage,
  deriveStatus,
  loadBotActivity,
  loadBotDashboard,
  loadBotRules,
  pauseBot,
  resumeBot,
  STATUS_LABELS,
  stopBot,
  summarizeFills,
  toNumberOrNull,
  updateBotSettings,
} from '../../../api/services/botDashboardService'
import ActivityFeed from '../../../ui/ActivityFeed'
import Disclosure from '../../../ui/Disclosure'
import ResearchCard from '../../../ui/ResearchCard'
import RuleEditor, { draftFromBot, saveBotRules, validateDraft } from '../../../ui/RuleEditor'
import { EmergencyBanner, useEmergencyStop } from '../../../ui/Safety'
import { describeAction, describeGuards, isResearchBot } from '../../../ui/describeBot'
import { ago, dateTime, money, moneyWhole, plural, sessionDate, shares, signedMoney, tone } from '../../../ui/format'

export const REFRESH_MS = 30_000
export const fmtMoney = money
const fmtWhen = dateTime
const PENDING = new Set(['queued', 'processing', 'submitted', 'partially_filled', 'needs_reconciliation'])
const MAX_WATCHED = 6

// ── 1. What does this bot do? ───────────────────────────────────────────────

function RulesSheet({ bot, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => draftFromBot(bot))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const errors = validateDraft(draft)
  const save = async () => {
    setSubmitted(true)
    if (Object.keys(errors).length) return
    setSaving(true)
    setError(null)
    const r = await saveBotRules({ bot, draft, api: { put, post, del } })
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    onSaved()
  }
  return (
    <Sheet title="Edit rules" size="wide" onClose={onClose} footer={
      <>
        <button type="button" className="tl-btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="tl-btn tl-btn--primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</button>
      </>
    }>
      <RuleEditor value={draft} onChange={setDraft} errors={submitted ? errors : {}} direction={bot.direction ?? 'buy'} idPrefix="edit" />
      <p className="tl-help" style={{ marginTop: 14 }}>Changes apply from the bot’s next check.</p>
      {error && <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Sheet>
  )
}

function WhatItDoes({ bot, onEdit }) {
  return (
    <section className="tl-section" id="behavior" aria-labelledby="behavior-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="behavior-title">What it does</h2>
        {!bot.stopped && <button type="button" className="tl-link-btn" onClick={onEdit}>Edit rules</button>}
      </div>
      <p className="tl-lead-sentence">{describeAction(bot)}</p>
      <ul className="tl-rule-list" data-testid="rule-summary">{describeGuards(bot).map((g) => <li key={g}>{g}</li>)}</ul>
    </section>
  )
}

// ── 2. What is it seeing? ───────────────────────────────────────────────────

function trendText(r) {
  if (!r) return null
  if (r.regime === 'risk_on') return 'Uptrend (above its 200-day average)'
  if (r.regime === 'risk_off') return 'Downtrend (below its 200-day average)'
  return r.regime ? String(r.regime).replace(/_/g, ' ') : null
}

function WhatItSees({ bot, timeline }) {
  const symbols = bot.tickers.slice(0, MAX_WATCHED)
  const [regimes, setRegimes] = useState({})
  useEffect(() => {
    let live = true
    Promise.all(symbols.map((s) => get(`/engine/regime/${encodeURIComponent(s)}`).then((d) => [s, d]).catch(() => [s, null])))
      .then((pairs) => live && setRegimes(Object.fromEntries(pairs)))
    return () => { live = false }
  }, [bot.id, symbols.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (symbols.length === 0) return null
  const latestFor = (s) => timeline.find((i) => i.symbol === s && ['evaluation', 'skip', 'risk', 'signal', 'order', 'fill'].includes(i.category))
  const research = isResearchBot(bot.config)
  return (
    <section className="tl-section" aria-labelledby="seeing-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="seeing-title">What it’s seeing</h2>
        <span className="tl-section-aside tl-muted tl-small tl-hide-sm">Latest close and data the bot checks</span>
      </div>
      <table className="tl-table" data-testid="watching">
        <thead><tr><th>Symbol</th><th className="r">Last close</th><th className="tl-hide-sm">Trend</th>{research && <th>Research</th>}<th>Latest check</th></tr></thead>
        <tbody>
          {symbols.map((s) => {
            const r = regimes[s]
            const last = latestFor(s)
            return (
              <tr key={s}>
                <td className="tl-sym">{s}</td>
                <td className="r">{r?.close ? money(r.close) : '—'}<span className="tl-sub">{r?.asOf ? sessionDate(r.asOf) : ''}</span></td>
                <td className="tl-hide-sm tl-small">{trendText(r) ?? <span className="tl-muted">—</span>}</td>
                {research && <td><ResearchCard symbol={s} compact /></td>}
                <td className="tl-small">{last ? <>{last.title}<span className="tl-sub">{ago(last.at)}</span></> : <span className="tl-muted">Not checked yet</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {bot.tickers.length > MAX_WATCHED && <p className="tl-section-note">Showing {MAX_WATCHED} of {bot.tickers.length} symbols.</p>}
    </section>
  )
}

// ── 3. Why did it act or wait? ──────────────────────────────────────────────

function WhyItActed({ activity, status, onRetry }) {
  const { timeline, eventsAvailable, executionsAvailable } = activity
  return (
    <section className="tl-section" aria-labelledby="activity-title">
      <div className="tl-section-head">
        <h2 className="tl-section-title" id="activity-title">Why it acted or waited</h2>
        <button type="button" className="tl-link-btn" onClick={onRetry}>Refresh</button>
      </div>
      {!eventsAvailable && !executionsAvailable ? (
        <div className="tl-notice tl-notice--warn" role="status" data-testid="activity-unavailable" style={{ marginTop: 14 }}>
          Activity is unavailable right now. <button type="button" className="tl-link-btn" onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <>
          {!eventsAvailable && <p className="tl-section-note" data-testid="events-unavailable">The bot’s decision log is unavailable right now, so only orders are shown.</p>}
          {!executionsAvailable && <p className="tl-section-note" data-testid="orders-unavailable">Order history is unavailable right now, so only decisions are shown.</p>}
          {timeline.length === 0 ? (
            <p className="tl-feed-empty" data-testid="activity-empty">
              No activity yet. {status === 'paused' ? 'Resume the bot to start it.' : status === 'stopped' ? '' : 'Its checks, decisions and trades appear here as it runs.'}
            </p>
          ) : (
            <ActivityFeed items={timeline.map((i) => ({ ...i, researchBot: activity.researchBot }))} limit={15} routine="summary" showBot={false} testId="timeline" />
          )}
        </>
      )}
    </section>
  )
}

// ── 4. What has happened? ───────────────────────────────────────────────────

function PendingOrders({ executions, onCancelled }) {
  const pending = (executions ?? []).filter((x) => PENDING.has(x.status))
  const [busy, setBusy] = useState({})
  const [errors, setErrors] = useState({})
  if (pending.length === 0) return null
  const cancel = async (x) => {
    setBusy((b) => ({ ...b, [x.id]: true }))
    setErrors((e) => ({ ...e, [x.id]: null }))
    try {
      const r = await post(`/executions/${encodeURIComponent(x.id)}/cancel`, {})
      onCancelled(r?.cancelOutcome === 'requested' ? 'Cancellation requested — the order won’t be sent, or will be cancelled at the broker.' : 'Order cancelled.')
    } catch (err) {
      setErrors((e) => ({ ...e, [x.id]: err?.code === 'NOT_CANCELLABLE' ? 'Too late to cancel — it’s already being filled.' : 'Couldn’t cancel. Try again.' }))
    } finally {
      setBusy((b) => ({ ...b, [x.id]: false }))
    }
  }
  return (
    <div data-testid="pending-orders" style={{ marginTop: 22 }}>
      <h4 className="tl-rules-head">Open orders</h4>
      <ul className="tl-list">
        {pending.map((x) => (
          <li key={x.id} className="tl-mini-row">
            <span>
              <strong>{x.side === 'sell' ? 'Sell' : 'Buy'} {shares(x.quantity)} {x.symbol}</strong>
              <span className="tl-sub">{x.status === 'needs_reconciliation' ? 'Being checked' : x.status === 'queued' ? 'Waiting to be sent' : 'Sent, waiting for a fill'} · {ago(x.createdAt)}</span>
              {errors[x.id] && <span className="tl-sub tl-neg" role="alert">{errors[x.id]}</span>}
            </span>
            {x.status !== 'needs_reconciliation' && (
              <button type="button" className="tl-btn tl-btn--sm" onClick={() => cancel(x)} disabled={busy[x.id]}>{busy[x.id] ? 'Cancelling…' : 'Cancel order'}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WhatHappened({ bot, fills, activity, onCancelled }) {
  const p = bot.performance
  const positions = Object.values(bot.openPositions ?? {})
  return (
    <section className="tl-section" id="impact" aria-labelledby="perf-title">
      <div className="tl-section-head"><h2 className="tl-section-title" id="perf-title">What has happened</h2></div>
      {p ? (
        <dl className="tl-stats tl-stats--3" data-testid="performance" style={{ borderTop: 0 }}>
          <div className="tl-stat">
            <dt>P&amp;L</dt>
            <dd className={tone(p.total)}>{p.total !== null ? signedMoney(p.total) : '—'}<small>{p.total === null ? 'Waiting for a price' : `${signedMoney(p.realized)} realized`}</small></dd>
          </div>
          <div className="tl-stat">
            <dt>Capital in use</dt>
            <dd data-testid="capital-in-use">{bot.capitalInUse !== null ? money(bot.capitalInUse) : '—'}<small>of <span data-testid="capital-allocation">{bot.allocation !== null ? money(bot.allocation) : 'no set capital'}</span></small></dd>
          </div>
          <div className="tl-stat">
            <dt>Trades</dt>
            <dd data-testid="fill-summary">{fills ? plural(fills.filledOrders, 'fill') : '—'}<small>{fills?.costs > 0 ? `${money(fills.costs)} in fees` : 'no fees'}</small></dd>
          </div>
        </dl>
      ) : (
        <p className="tl-section-note" data-testid="performance-unavailable" style={{ fontSize: 14.5 }}>
          No trades yet. It may spend up to <span data-testid="capital-allocation">{bot.allocation !== null ? money(bot.allocation) : 'its capital'}</span>
          {bot.maxPerOrder !== null ? `, at most ${money(bot.maxPerOrder)} per order` : ''}.
          <span data-testid="fill-summary" className="tl-visually-hidden">{fills ? plural(fills.filledOrders, 'fill') : ''}</span>
        </p>
      )}
      {p?.valuation?.simulated && (
        <p className="tl-section-note" data-testid="performance-valuation">
          Holdings valued at the {[...new Set(Object.values(p.valuation.sessions ?? {}))].map((s) => sessionDate(s)).join(', ')} close · simulated fills. Capital isn’t set aside — it caps what this bot may spend.
        </p>
      )}
      {positions.length > 0 && (
        <table className="tl-table" data-testid="bot-holdings-table" style={{ marginTop: 18 }}>
          <thead><tr><th>Holding</th><th className="r">Shares</th><th className="r tl-hide-sm">Avg cost</th><th className="r">Last close</th><th className="r">Value</th><th className="r">Return</th></tr></thead>
          <tbody>
            {positions.map((x) => (
              <tr key={x.ticker}>
                <td><Link className="tl-sym" to={`/?holding=${encodeURIComponent(x.ticker)}`}>{x.ticker}</Link></td>
                <td className="r">{shares(x.quantity)}</td>
                <td className="r tl-hide-sm">{money(x.avgPrice)}</td>
                <td className="r">{money(x.currentPrice)}</td>
                <td className="r">{x.currentPrice !== null && x.currentPrice !== undefined ? money(x.quantity * x.currentPrice) : '—'}</td>
                <td className={`r ${tone(x.unrealizedPnl)}`}>{signedMoney(x.unrealizedPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PendingOrders executions={activity.executions} onCancelled={onCancelled} />
    </section>
  )
}

function AdvancedDetails({ bot }) {
  const [rules, setRules] = useState(undefined) // undefined = not loaded, null = unavailable
  return (
    <div className="tl-section" style={{ marginTop: 40 }}>
      <Disclosure label="Technical details" onOpen={() => loadBotRules(bot.id).then(setRules)} testId="technical-details">
        <div className="tl-evidence-body">
          <dl>
            <dt>Starting point</dt><dd>{bot.strategyName ?? bot.templateId ?? 'Custom'}</dd>
            <dt>Bot ID</dt><dd>{bot.id}</dd>
            <dt>Created</dt><dd>{fmtWhen(bot.createdAt) || '—'}</dd>
            <dt>Rules</dt><dd>
              {rules === undefined ? 'Loading…' : rules === null ? 'Unavailable right now.' : rules.length === 0 ? 'None saved.' : (
                <ul className="tl-small m0" style={{ paddingLeft: 16 }} data-testid="rules-list">
                  {rules.map((r) => <li key={r.id}>{r.name ?? r.type}{r.enabled === false ? ' (off)' : ''}</li>)}
                </ul>
              )}
            </dd>
          </dl>
          <pre className="bot-config" style={{ fontSize: 12, overflowX: 'auto', margin: '10px 0 0' }}>{JSON.stringify(bot.config, null, 2)}</pre>
        </div>
      </Disclosure>
    </div>
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
      title="Name & capital"
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
      <p style={{ margin: 0 }}>The bot stops for good and won’t place new orders. Its history stays here.</p>
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
  const [notice, setNotice] = useState(location.state?.created ? 'Your bot was created and is running on simulated money. You can pause it anytime.' : null)
  const { stop, clear } = useEmergencyStop()

  // The "created" confirmation is one-time: drop it from history so a reload doesn't repeat it.
  useEffect(() => {
    if (location.state?.created) window.history.replaceState({ ...window.history.state, usr: { ...location.state, created: false } }, '')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const result = await loadBotDashboard(botId)
    setState({ loading: false, ...result })
  }, [botId])

  useEffect(() => {
    setState({ loading: true })
    load()
  }, [load])

  useEffect(() => {
    if (!state.loading && location.state?.focus === 'behavior') document.getElementById('behavior')?.scrollIntoView?.({ block: 'start' })
  }, [state.loading]) // eslint-disable-line react-hooks/exhaustive-deps

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
      setNotice(action === 'pause' ? 'Paused. The bot won’t place new orders until you resume it.' : 'Resumed. The bot is running again.')
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

  const back = location.state?.from === 'bots' ? { to: '/bots', label: 'Bots' } : location.state?.from === 'home' ? { to: '/', label: 'Home' } : { to: '/bots', label: 'Bots' }

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
  const research = isResearchBot(bot.config)

  return (
    <main className="tl-page">
      <EmergencyBanner stop={stop} onClear={clear} />
      <Link to={back.to} className="tl-back">← {back.label}</Link>

      <header className="tl-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="tl-title">{bot.name}</h1>
            <span className={`tl-status tl-status--${status}`} data-testid="bot-status">{STATUS_LABELS[status] ?? status}</span>
          </div>
          <p className="tl-lede">{bot.tickers.length ? bot.tickers.join(', ') : 'No symbols'} · {research ? 'Research signal' : 'Rule-based'}{bot.allocation !== null ? ` · ${moneyWhole(bot.allocation)} capital` : ''}</p>
        </div>
        {!bot.stopped && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={`tl-btn ${bot.enabled ? '' : 'tl-btn--primary'}`} onClick={toggle} disabled={busy} style={{ minWidth: 88 }}>
              {busy ? 'Saving…' : bot.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className="tl-btn" onClick={() => setSheet('edit')} disabled={busy}>Name &amp; capital</button>
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

      <WhatItDoes bot={bot} onEdit={() => setSheet('rules')} />
      <WhatItSees bot={bot} timeline={activity.timeline} />
      <WhyItActed activity={{ ...activity, researchBot: research }} status={status} onRetry={refreshActivity} />
      <WhatHappened bot={bot} fills={fills} activity={activity} onCancelled={(msg) => { setNotice(msg); refreshActivity() }} />

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
      {sheet === 'rules' && (
        <RulesSheet bot={bot} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); setNotice('Rules saved. They apply from the bot’s next check.'); load() }} />
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
