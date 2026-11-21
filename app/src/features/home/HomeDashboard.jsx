import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/AuthProvider'
import { getTradingMode } from '../../components/ModeBadge'
import { loadHome, setBotRunning } from './homeApi'
import { STATUS_LABELS, controlErrorMessage, deriveStatus } from '../../api/services/botDashboardService'
import StatusPill from '../../components/BotStatusPill'

const UNAVAILABLE = '—'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function fmtMoney(n) {
  return n === null || n === undefined ? UNAVAILABLE : currency.format(n)
}

export function fmtSignedMoney(n) {
  if (n === null || n === undefined) return UNAVAILABLE
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${currency.format(Math.abs(n))}`
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function toneClass(n) {
  if (n === null || n === undefined || n === 0) return ''
  return n > 0 ? 'text-positive' : 'text-negative'
}

function BalanceCard({ account, today, mode }) {
  const connected = mode !== 'none'
  return (
    <section className="card card-pad-md home-balance" aria-labelledby="home-balance-label">
      <div className="eyebrow mb-0" id="home-balance-label">
        {mode === 'paper' ? 'Paper account balance' : 'Account balance'}
      </div>
      <div className="home-balance-value" data-testid="balance-equity">
        {fmtMoney(account?.equity ?? null)}
      </div>
      <dl className="home-balance-meta">
        <div>
          <dt className="muted">Realized today</dt>
          <dd className={toneClass(today?.realizedPnl)} data-testid="balance-today">
            {fmtSignedMoney(today?.realizedPnl ?? null)}
            {today?.trades !== null && today?.trades !== undefined && (
              <span className="muted"> · {today.trades} {today.trades === 1 ? 'trade' : 'trades'}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="muted">Cash</dt>
          <dd>{fmtMoney(account?.cash ?? null)}</dd>
        </div>
        {account?.buyingPower !== null && account?.buyingPower !== undefined && (
          <div>
            <dt className="muted">Buying power</dt>
            <dd>{fmtMoney(account.buyingPower)}</dd>
          </div>
        )}
      </dl>
      {connected ? (
        <div className="flex gap-4 mt-2">
          <Link className="home-link" to="/portfolio">View portfolio →</Link>
          <Link className="home-link text-xs muted" to="/history">Trade history →</Link>
        </div>
      ) : (
        <div className="alert alert-warn mt-3" role="status">
          No trading account connected.{' '}
          <Link to="/profile/broker">Connect a paper account</Link> to see your balance and run bots.
        </div>
      )}
    </section>
  )
}

function lastActivityText(bot) {
  if (bot.lastActivity) {
    const a = bot.lastActivity
    return `${a.title}${a.symbol && !a.title.includes(a.symbol) ? ` · ${a.symbol}` : ''} · ${fmtTime(a.at)}`
  }
  return bot.activityAvailable ? 'No activity yet' : 'Activity unavailable'
}

/** Name, status, allocation, P/L (when supplied), last activity, one control. */
function BotCard({ bot, busy, error, onToggle }) {
  const control = bot.stopped ? null : bot.running ? 'Pause' : 'Resume'
  // Total only when the backend knows unrealized P/L; otherwise realized, labeled as such.
  const pnlIsTotal = bot.performance?.total !== null && bot.performance?.total !== undefined
  const pnl = pnlIsTotal ? bot.performance.total : bot.performance?.realized ?? null
  return (
    <li className="card card-pad-sm home-bot" data-testid="bot-card">
      <div className="home-bot-row">
        <Link to={`/bots/${bot.id}`} className="home-bot-link" aria-label={`${bot.name}, ${STATUS_LABELS[bot.status]}`}>
          <span className="home-bot-name">{bot.name}</span>
          <span className="home-bot-meta muted">
            <span>{bot.allocation !== null ? `${fmtMoney(bot.allocation)} simulated` : 'Capital not set'}</span>
            {pnl !== null && <span className={toneClass(pnl)} data-testid="bot-pnl">{fmtSignedMoney(pnl)}{pnlIsTotal ? '' : ' realized'}</span>}
          </span>
          <span className="home-bot-last muted" data-testid="bot-last-activity">{lastActivityText(bot)}</span>
        </Link>
        <div className="home-bot-side">
          <StatusPill status={bot.status} />
          {control && (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => onToggle(bot)}
              disabled={busy}
              aria-label={`${control} ${bot.name}`}
            >
              {busy ? 'Saving…' : control}
            </button>
          )}
        </div>
      </div>
      {error && <div className="text-negative text-xs mt-1" role="alert">{error}</div>}
    </li>
  )
}

function ActivityList({ items, error }) {
  if (error) return <p className="muted">{error}</p>
  if (items.length === 0) return <p className="muted">No bot activity yet. Checks and paper orders appear here once a bot runs.</p>
  return (
    <ul className="home-activity" data-testid="activity-list">
      {items.map((e) => (
        <li key={`${e.botId}:${e.id}`} className="home-activity-row">
          <span>
            <Link to={`/bots/${e.botId}`}><strong>{e.botName}</strong></Link>{' '}
            {e.title}{e.symbol && !e.title.includes(e.symbol) ? ` · ${e.symbol}` : ''}
          </span>
          <span className="muted text-xs text-nowrap">{fmtTime(e.at)}</span>
        </li>
      ))}
    </ul>
  )
}

export default function HomeDashboard() {
  const { user, brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const [state, setState] = useState({ loading: true, data: null })
  const [busy, setBusy] = useState({})
  const [errors, setErrors] = useState({})

  const refresh = useCallback(async () => {
    const data = await loadHome()
    setState({ loading: false, data })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggleBot = async (bot) => {
    const resuming = !bot.running
    setBusy((b) => ({ ...b, [bot.id]: true }))
    setErrors((e) => ({ ...e, [bot.id]: null }))
    try {
      await setBotRunning(bot.id, resuming)
      setState((s) => ({
        ...s,
        data: {
          ...s.data,
          bots: s.data.bots.map((b) => {
            if (b.id !== bot.id) return b
            const next = { ...b, enabled: resuming, running: resuming }
            return { ...next, status: deriveStatus(next, next.lastActivity ? [next.lastActivity] : []) }
          }),
        },
      }))
    } catch (err) {
      setErrors((e) => ({ ...e, [bot.id]: controlErrorMessage(err, resuming ? 'resume' : 'pause') }))
    } finally {
      setBusy((b) => ({ ...b, [bot.id]: false }))
    }
  }

  const firstName = (user?.fullName ?? user?.name ?? '').split(' ')[0]
  const data = state.data
  const runningCount = data?.bots.filter((b) => b.running).length ?? 0

  return (
    <main className="page container home" aria-busy={state.loading}>
      <header className="home-header">
        <h1 className="home-title">{firstName ? `Hi, ${firstName}` : 'Home'}</h1>
        {data && data.bots.length > 0 && (
          <p className="muted m-0">
            {runningCount} of {data.bots.length} {data.bots.length === 1 ? 'bot' : 'bots'} running
          </p>
        )}
      </header>

      {state.loading ? (
        <div className="l-stack-md" data-testid="home-loading">
          <div className="card card-pad-md skeleton-block home-skeleton" />
          <div className="card card-pad-md skeleton-block home-skeleton" />
        </div>
      ) : (
        <div className="home-grid">
          <BalanceCard account={data.account} today={data.today} mode={mode} />

          <section aria-labelledby="home-bots-title" className="home-bots">
            <div className="home-section-head">
              <h2 className="panel-title m-0" id="home-bots-title">Your bots</h2>
              <Link to="/bots/new" className="btn btn-sm btn-primary">Add bot</Link>
            </div>
            {data.botsError ? (
              <p className="text-negative">{data.botsError}</p>
            ) : data.bots.length === 0 ? (
              <div className="card card-pad-md home-empty">
                <p className="m-0"><strong>You don’t have any bots yet.</strong></p>
                <p className="muted">Pick a strategy, give it simulated capital, and watch what it does in paper trading. You can pause it anytime.</p>
              </div>
            ) : (
              <ul className="home-bot-list">
                {data.bots.map((bot) => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    busy={Boolean(busy[bot.id])}
                    error={errors[bot.id]}
                    onToggle={toggleBot}
                  />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="home-activity-title" className="card card-pad-md home-activity-card">
            <h2 className="panel-title" id="home-activity-title">Recent bot activity</h2>
            <ActivityList items={data.activity} error={data.activityError} />
          </section>
        </div>
      )}

      <footer className="home-footer muted text-sm">
        Paper trading uses simulated money. Live trading is disabled.{' '}
        <Link to="/research">Market research</Link>
      </footer>
    </main>
  )
}
