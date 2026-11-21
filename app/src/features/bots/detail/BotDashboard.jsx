import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Sheet from '../../../components/Sheet'
import StatusPill from '../../../components/BotStatusPill'
import {
  controlErrorMessage,
  deriveStatus,
  getExecutionResearch,
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
const PAGE = 15

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const fmtMoney = (n) => (n === null || n === undefined ? '—' : money.format(n))
const fmtSigned = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${money.format(Math.abs(n))}`)
const tone = (n) => (n > 0 ? 'text-positive' : n < 0 ? 'text-negative' : '')

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

function CapitalCard({ bot, buyingPower }) {
  return (
    <section className="card card-pad-md" aria-labelledby="capital-title">
      <h2 className="panel-title" id="capital-title">Capital</h2>
      <dl className="bot-facts">
        <div>
          <dt>Simulated capital</dt>
          <dd data-testid="capital-allocation">{bot.allocation !== null ? fmtMoney(bot.allocation) : 'Not set'}</dd>
        </div>
        <div>
          <dt>Max per buy order</dt>
          <dd>{bot.maxPerOrder !== null ? fmtMoney(bot.maxPerOrder) : 'Not set'}</dd>
        </div>
        <div>
          <dt>In use</dt>
          {bot.capitalInUse !== null ? (
            <dd data-testid="capital-in-use">{fmtMoney(bot.capitalInUse)}</dd>
          ) : (
            <dd className="muted" data-testid="capital-in-use">Not available yet</dd>
          )}
        </div>
        <div>
          <dt>Paper buying power</dt>
          <dd>{fmtMoney(buyingPower)}</dd>
        </div>
      </dl>
      <p className="muted text-xs m-0">Capital isn’t set aside. It caps the size of each buy order. Buying power is for your whole paper account.</p>
    </section>
  )
}

function PerformanceCard({ performance, fills, executionsAvailable }) {
  return (
    <section className="card card-pad-md" aria-labelledby="perf-title">
      <h2 className="panel-title" id="perf-title">Performance</h2>
      {performance ? (
        <dl className="bot-facts" data-testid="performance">
          {performance.total !== null ? (
            <>
              <div>
                <dt>Total P/L</dt>
                <dd className={`bot-big ${tone(performance.total)}`}>{fmtSigned(performance.total)}</dd>
              </div>
              <div><dt>Realized</dt><dd className={tone(performance.realized)}>{fmtSigned(performance.realized)}</dd></div>
            </>
          ) : (
            <div>
              <dt>Realized P/L</dt>
              <dd className={`bot-big ${tone(performance.realized)}`}>{fmtSigned(performance.realized)}</dd>
            </div>
          )}
          <div>
            <dt>Unrealized</dt>
            {performance.unrealized !== null ? (
              <dd className={tone(performance.unrealized)}>{fmtSigned(performance.unrealized)}</dd>
            ) : (
              <dd className="muted" data-testid="unrealized-unavailable">Not available yet</dd>
            )}
          </div>
          {performance.fees !== null && <div><dt>Fees</dt><dd>{fmtMoney(performance.fees)}</dd></div>}
        </dl>
      ) : (
        <p className="m-0" data-testid="performance-unavailable">
          <span className="muted">Profit and loss for this bot isn’t available yet.</span>
        </p>
      )}
      {performance?.valuation?.simulated && (
        <p className="muted text-xs mb-0" data-testid="performance-valuation">
          Simulated: open positions valued at the latest known daily close ({[...new Set(Object.values(performance.valuation.sessions ?? {}))].join(', ')}).
        </p>
      )}
      {performance?.asOf && <p className="muted text-xs mb-0">As of {fmtWhen(performance.asOf)}</p>}
      {fills && executionsAvailable && (
        <p className="text-sm mb-0" data-testid="fill-summary">
          {fills.filledOrders} filled {fills.filledOrders === 1 ? 'order' : 'orders'}
          {fills.costs > 0 && <> · {fmtMoney(fills.costs)} in fees and commissions</>}
        </p>
      )}
    </section>
  )
}

function Diagnostics({ data }) {
  const entries = Object.entries(data ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (entries.length === 0) return null

  const hasIntelligence = Boolean(
    data.rankingScore !== undefined ||
    data.rank !== undefined ||
    data.conviction !== undefined ||
    data.mlFeatures !== undefined ||
    data.suppressionReason !== undefined ||
    data.orderEligibility !== undefined
  )

  return (
    <details className="timeline-diag">
      <summary>Details</summary>
      {hasIntelligence && (
        <div className="intelligence-summary mb-2 p-2 bg-subtle rounded border text-xs">
          <strong className="block text-primary mb-1">Alpha Engine Research & Decision:</strong>
          {data.rankingScore !== undefined && (
            <div>Ranking Score: {typeof data.rankingScore === 'number' ? data.rankingScore.toFixed(2) : data.rankingScore}</div>
          )}
          {data.conviction && <div>Conviction: {String(data.conviction)}</div>}
          {data.orderEligibility && <div>Order Eligibility: {String(data.orderEligibility).toUpperCase()}</div>}
          {data.suppressionReason && (
            <div className="text-warn font-500">Suppression: {String(data.suppressionReason)}</div>
          )}
          {data.mlFeatures && (
            <div className="mt-1">
              <span className="muted font-500">ML Model Evidence: </span>
              {typeof data.mlFeatures === 'object' ? JSON.stringify(data.mlFeatures) : String(data.mlFeatures)}
            </div>
          )}
        </div>
      )}
      <dl>
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function BotHoldingsCard({ executions }) {
  const positions = useMemo(() => {
    if (!executions) return []
    const filled = executions.filter((x) => x.status === 'filled')
    const posMap = {}
    for (const e of filled) {
      const sym = e.symbol
      if (!sym) continue
      if (!posMap[sym]) posMap[sym] = { symbol: sym, quantity: 0, cost: 0 }
      const price = e.filledPrice || e.intentPrice || 0
      if (e.side === 'buy') {
        posMap[sym].quantity += e.quantity || 0
        posMap[sym].cost += (e.quantity || 0) * price
      } else if (e.side === 'sell') {
        const remaining = Math.max(0, posMap[sym].quantity - (e.quantity || 0))
        const ratio = posMap[sym].quantity > 0 ? remaining / posMap[sym].quantity : 0
        posMap[sym].quantity = remaining
        posMap[sym].cost = posMap[sym].cost * ratio
      }
    }
    return Object.values(posMap)
      .filter((p) => p.quantity > 0)
      .map((p) => ({
        ...p,
        avgPrice: p.quantity > 0 ? p.cost / p.quantity : 0,
      }))
  }, [executions])

  return (
    <section className="card card-pad-md" aria-labelledby="holdings-title">
      <h2 className="panel-title" id="holdings-title">Bot Holdings</h2>
      {positions.length === 0 ? (
        <p className="muted text-sm m-0" data-testid="bot-holdings-empty">
          No open positions held by this bot.
        </p>
      ) : (
        <div className="table-responsive">
          <table className="table w-full text-sm" data-testid="bot-holdings-table">
            <thead>
              <tr>
                <th className="text-left">Symbol</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Avg Price</th>
                <th className="text-right">Cost Basis</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.symbol}>
                  <td className="font-600">
                    <Link to={`/assets/${p.symbol}`}>{p.symbol}</Link>
                  </td>
                  <td className="text-right">{p.quantity}</td>
                  <td className="text-right">{fmtMoney(p.avgPrice)}</td>
                  <td className="text-right">{fmtMoney(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const pct = (v) => (v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`)

function ResearchSummary({ research }) {
  if (!research) return null
  const h = research.holdout
  return (
    <dl className="research-facts text-xs" data-testid="research-summary">
      <div><dt>Research</dt><dd>{research.direction} · {research.horizon} · observed {research.observedAt?.slice(0, 10) ?? '—'}{research.mode === 'historical_replay' ? ' · historical replay' : ''}</dd></div>
      <div><dt>Score</dt><dd>{research.score ?? '—'} <span className="muted">(strategy score, not a probability)</span></dd></div>
      {h && <div><dt>Holdout</dt><dd>{pct(h.precision)} hit rate vs {pct(h.baselineRate)} always-up baseline ({h.signals} signals) — {research.edgeOverBaseline ? 'beat the baseline' : 'no edge over the baseline'}</dd></div>}
      {research.genuineOutOfSample === false && <div><dt>Evaluation</dt><dd>Pseudo-out-of-sample: the rule was fixed in advance, but the holdout period was already observable.</dd></div>}
    </dl>
  )
}

/** Archived evidence for an order, verified by digest; loaded only when opened. */
function ResearchEvidence({ executionId }) {
  const [state, setState] = useState({ status: 'idle' })
  const onToggle = async (e) => {
    if (!e.currentTarget.open || state.status !== 'idle') return
    setState({ status: 'loading' })
    try {
      setState({ status: 'done', data: await getExecutionResearch(executionId) })
    } catch {
      setState({ status: 'error' })
    }
  }
  const d = state.data
  const ev = d?.evidence
  return (
    <details className="research-evidence text-xs" onToggle={onToggle} data-testid={`research-evidence-${executionId}`}>
      <summary>Research evidence</summary>
      {state.status === 'loading' && <p className="muted m-0">Loading…</p>}
      {state.status === 'error' && <p className="text-negative m-0">Couldn’t load the evidence.</p>}
      {state.status === 'done' && d?.status !== 'verified_digest' && (
        <p className="m-0" role="status">{d?.status === 'unavailable' ? 'No research decision is linked to this order.' : `Evidence check: ${d?.status ?? 'unknown'} — this order’s research can’t be verified.`}</p>
      )}
      {state.status === 'done' && d?.status === 'verified_digest' && (
        <dl className="research-facts">
          <div><dt>Integrity</dt><dd>Verified: archived evidence matches its SHA-256 digest <span className="muted">(integrity, not proof of accuracy)</span></dd></div>
          <div><dt>Prediction</dt><dd>{ev?.ticker} {ev?.direction} · {ev?.horizon} · observed {ev?.observedAt}</dd></div>
          <div><dt>Entry price</dt><dd>{fmtMoney(ev?.entryPrice)}</dd></div>
          <div><dt>Publication</dt><dd className="text-break">{ev?.ranking?.publicationId ?? '—'}{ev?.ranking?.mode === 'historical_replay' ? ' (historical replay)' : ''}</dd></div>
          <div><dt>Strategy</dt><dd>{ev?.strategyId ?? '—'}</dd></div>
          <div><dt>Digest</dt><dd className="text-break muted">{d.researchTrace?.evidenceSha256}</dd></div>
        </dl>
      )}
    </details>
  )
}

function Timeline({ activity, status, onRetry }) {
  const [shown, setShown] = useState(PAGE)
  const { timeline, eventsAvailable, executionsAvailable } = activity

  if (!eventsAvailable && !executionsAvailable) {
    return (
      <div className="alert alert-warn" role="status" data-testid="activity-unavailable">
        Activity is unavailable right now. <button type="button" className="btn btn-xs btn-ghost" onClick={onRetry}>Retry</button>
      </div>
    )
  }

  return (
    <>
      {!eventsAvailable && (
        <p className="muted text-sm" data-testid="events-unavailable">The bot’s decision log is unavailable right now, so only orders are shown.</p>
      )}
      {!executionsAvailable && (
        <p className="muted text-sm" data-testid="orders-unavailable">Order history is unavailable right now, so only decisions are shown.</p>
      )}
      {timeline.length === 0 ? (
        <p className="muted" data-testid="activity-empty">
          No activity yet.{' '}
          {status === 'paused' ? 'Resume the bot to start it.' : status === 'stopped' ? '' : 'Checks and paper orders will appear here as the bot runs.'}
        </p>
      ) : (
        <ol className="timeline" data-testid="timeline">
          {timeline.slice(0, shown).map((item) => (
            <li key={item.id} className={`timeline-item timeline-item--${item.category}`}>
              <span className="timeline-dot" aria-hidden="true" />
              <div className="timeline-main">
                <div className="timeline-head">
                  <span className="timeline-title">
                    {item.title}
                    {item.symbol && !item.title.includes(item.symbol) && <span className="timeline-symbol">{item.symbol}</span>}
                  </span>
                  <time className="muted text-xs" dateTime={item.at ?? undefined}>{fmtWhen(item.at)}</time>
                </div>
                {item.explanation && <p className="timeline-text">{item.explanation}</p>}
                <ResearchSummary research={item.research} />
                {item.executionId && (item.category === 'fill' || item.category === 'order') && <ResearchEvidence executionId={item.executionId} />}
                {item.count > 1 && (
                  <p className="muted text-xs m-0">Repeated {item.count} times since {fmtWhen(item.since)}</p>
                )}
                <Diagnostics data={item.diagnostics} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {timeline.length > shown && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShown((n) => n + PAGE)}>Show older activity</button>
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
    <details className="card card-pad-md bot-advanced" onToggle={onToggle}>
      <summary>Strategy and technical details</summary>
      <dl className="bot-facts mt-3">
        <div><dt>Strategy</dt><dd>{bot.strategyName ?? bot.templateId ?? 'Custom'}</dd></div>
        <div><dt>Type</dt><dd>{bot.botType === 'strategy_based' ? 'Strategy bot' : 'Rule bot'}</dd></div>
        <div><dt>Bot ID</dt><dd className="text-xs">{bot.id}</dd></div>
        <div><dt>Created</dt><dd>{fmtWhen(bot.createdAt) || '—'}</dd></div>
      </dl>
      <h3 className="text-sm mb-1">Rules</h3>
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
      <h3 className="text-sm mb-1">Configuration</h3>
      <pre className="bot-config">{JSON.stringify(bot.config, null, 2)}</pre>
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
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <label className="wizard-label" htmlFor="edit-name">Name</label>
      <input id="edit-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
      {submitted && errors.name && <div className="text-negative text-xs mt-1" role="alert">{errors.name}</div>}

      <label className="wizard-label mt-3" htmlFor="edit-allocation">Simulated capital ($)</label>
      <input id="edit-allocation" className="form-input" inputMode="decimal" value={allocation} onChange={(e) => setAllocation(e.target.value.replace(/[^0-9.]/g, ''))} />
      {submitted && errors.allocation && <div className="text-negative text-xs mt-1" role="alert">{errors.allocation}</div>}

      <label className="wizard-label mt-3" htmlFor="edit-max">Max per buy order ($)</label>
      <input id="edit-max" className="form-input" inputMode="decimal" value={maxPerOrder} onChange={(e) => setMaxPerOrder(e.target.value.replace(/[^0-9.]/g, ''))} />
      {submitted && errors.maxPerOrder && <div className="text-negative text-xs mt-1" role="alert">{errors.maxPerOrder}</div>}

      <p className="muted text-xs">Changes apply to the bot’s next orders.</p>
      {error && <div className="alert alert-error mt-2" role="alert">{error}</div>}
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
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy}>Keep bot</button>
          <button type="button" className="btn btn-sm btn-danger" onClick={confirm} disabled={busy}>{busy ? 'Stopping…' : 'Stop bot'}</button>
        </>
      }
    >
      <p className="m-0">The bot stops for good and won’t place new orders. Its history stays here.</p>
      <p className="muted text-sm">It doesn’t cancel orders already sent or sell what it bought. If you only want a break, pause it instead.</p>
      {error && <div className="alert alert-error mt-2" role="alert">{error}</div>}
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
      <main className="page container bot-page" aria-busy="true">
        <div className="card card-pad-md skeleton-block bot-skeleton" data-testid="bot-loading" />
      </main>
    )
  }

  if (!state.bot) {
    return (
      <main className="page container bot-page">
        <h1 className="bot-title">{state.notFound ? 'Bot not found' : 'Bot unavailable'}</h1>
        <p className="muted">{state.notFound ? 'This bot doesn’t exist or isn’t yours.' : state.error}</p>
        {!state.notFound && <button type="button" className="btn btn-sm btn-primary" onClick={() => { setState({ loading: true }); load() }}>Retry</button>}{' '}
        <Link to="/" className="btn btn-sm btn-ghost">Back to Home</Link>
      </main>
    )
  }

  const { bot, status, activity, buyingPower, fills } = state
  const latestError = status === 'error' ? activity.timeline[0] : null
  const direction = describeDirection(bot.direction)

  return (
    <main className="page container bot-page">
      <Link to="/" className="home-link">← Home</Link>

      <header className="bot-header">
        <div className="bot-header-main">
          <h1 className="bot-title">{bot.name}</h1>
          <StatusPill status={status} />
        </div>
        <p className="muted m-0">
          Paper trading{bot.tickers.length > 0 ? ` · ${bot.tickers.join(', ')}` : ''}{direction ? ` · ${direction}` : ''}
        </p>
        {!bot.stopped ? (
          <div className="bot-controls">
            <button type="button" className={`btn btn-sm ${bot.enabled ? 'btn-ghost' : 'btn-primary'}`} onClick={toggle} disabled={busy}>
              {busy ? 'Saving…' : bot.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSheet('edit')} disabled={busy}>Edit</button>
            <button type="button" className="btn btn-sm btn-ghost text-negative" onClick={() => setSheet('stop')} disabled={busy}>Stop</button>
          </div>
        ) : (
          <p className="text-sm">This bot is stopped and won’t place new orders. <Link to="/bots/new">Create a new bot</Link></p>
        )}
        {controlError && <div className="alert alert-error mt-2" role="alert">{controlError}</div>}
        {notice && !controlError && <div className="alert alert-success mt-2" role="status">{notice}</div>}
        {latestError && (
          <div className="alert alert-warn mt-2" role="status" data-testid="error-banner">
            <strong>{latestError.title}.</strong> {latestError.explanation} {bot.enabled && 'The bot is still on; you can pause it while this is investigated.'}
          </div>
        )}
      </header>

      <div className="bot-summary">
        <PerformanceCard performance={bot.performance} fills={fills} executionsAvailable={activity.executionsAvailable} />
        <CapitalCard bot={bot} buyingPower={buyingPower} />
      </div>

      <BotHoldingsCard executions={activity.executions} />

      <section className="card card-pad-md" aria-labelledby="activity-title">
        <div className="home-section-head">
          <h2 className="panel-title m-0" id="activity-title">Activity</h2>
          <button type="button" className="btn btn-xs btn-ghost" onClick={refreshActivity}>Refresh</button>
        </div>
        <Timeline activity={activity} status={status} onRetry={refreshActivity} />
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
