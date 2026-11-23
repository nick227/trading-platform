import { Link } from 'react-router-dom'
import { STATUS_LABELS } from '../api/services/botDashboardService'
import AlgorithmIdentity, { algorithmIdentity } from './AlgorithmIdentity'
import { describeAction } from './describeBot'
import { ago, listJoin, moneyWhole, signedMoney, tone } from './format'

function lastAction(bot) {
  const a = bot.lastActivity
  if (a) return `${a.title}${a.symbol && !a.title.includes(a.symbol) ? ` · ${a.symbol}` : ''} · ${ago(a.at)}`
  return bot.activityAvailable ? 'No activity yet' : 'Activity unavailable'
}

/** One bot row for Home and Bots: what it does, what it holds, its P&L, and one control. */
export default function BotRow({ bot, busy, error, onToggle, from = 'home' }) {
  const control = bot.stopped ? null : bot.running ? 'Pause' : 'Resume'
  const pnl = bot.performance?.total ?? null
  const holdings = Object.keys(bot.openPositions ?? {})
  return (
    <li className={`tl-bot tl-machine-card tl-machine-card--${bot.status}`} data-testid="bot-card">
      <Link to={`/bots/${bot.id}`} state={{ from }} className="tl-bot-main" aria-label={`${bot.name}, ${STATUS_LABELS[bot.status]}`}>
        <div className="tl-machine-heading">
          <AlgorithmIdentity bot={bot} />
          <div className="tl-machine-heading-copy">
            <span className="tl-machine-family">{algorithmIdentity(bot).label}</span>
            <span className="tl-bot-name"><span>{bot.name}</span><span className={`tl-status tl-status--${bot.status}`} data-testid="bot-status">{STATUS_LABELS[bot.status]}</span></span>
          </div>
        </div>
        <span className="tl-bot-sentence" style={{ display: 'block' }}>{describeAction(bot)}</span>
        <span className="tl-bot-meta">
          {holdings.length > 0 && <span>Holds {listJoin(holdings, 3)}</span>}
          <span>{bot.capitalInUse !== null && bot.allocation !== null ? `${moneyWhole(bot.capitalInUse)} of ${moneyWhole(bot.allocation)} in use` : bot.allocation !== null ? `${moneyWhole(bot.allocation)} capital` : 'Capital not set'}</span>

        </span>
        <span className="tl-machine-last" data-testid="bot-last-activity"><span aria-hidden="true">↳</span> {lastAction(bot)}</span>
      </Link>
      <div className="tl-bot-side">
        <div className="tl-bot-figure">
          {pnl !== null ? <b className={tone(pnl)} data-testid="bot-pnl">{signedMoney(pnl)}</b> : <b className="tl-faint">—</b>}
          <span>{pnl !== null ? 'P&L' : bot.performance ? 'P&L pending prices' : 'P&L unavailable'}</span>
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
