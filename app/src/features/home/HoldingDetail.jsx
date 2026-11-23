import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../../api/client'
import { normalizeExecution, STATUS_LABELS } from '../../api/services/botDashboardService'
import ResearchCard from '../../ui/ResearchCard'
import ValueChart from '../../ui/ValueChart'
import { money, plural, sessionDate, shares, signedMoney, signedPct, tone } from '../../ui/format'
import { loadPriceHistory } from './homeApi'

const RANGES = ['1M', '3M', '1Y']

/** Inline detail for one holding: price + fills, position, research, bots, and actions. */
export default function HoldingDetail({ position: p, bots, busy, onToggleBot }) {
  const sym = p.symbol
  const [range, setRange] = useState('3M')
  const [prices, setPrices] = useState({ status: 'loading', points: [] })
  const [fills, setFills] = useState(null)

  useEffect(() => {
    let live = true
    setPrices((x) => ({ ...x, status: 'loading' }))
    loadPriceHistory(sym, range)
      .then((points) => live && setPrices({ status: 'done', points }))
      .catch(() => live && setPrices({ status: 'error', points: [] }))
    return () => { live = false }
  }, [sym, range])

  useEffect(() => {
    let live = true
    get('/executions', { ticker: sym, limit: 50 })
      .then((rows) => live && setFills((Array.isArray(rows) ? rows : []).map((x) => ({ ...normalizeExecution(x), botId: x.botId })).filter((x) => x.filledQuantity > 0)))
      .catch(() => live && setFills([]))
    return () => { live = false }
  }, [sym])

  const markers = (fills ?? []).map((f) => ({
    t: f.replaySession ?? String(f.filledAt ?? '').slice(0, 10),
    kind: f.side,
    label: `${f.side === 'sell' ? 'Sold' : 'Bought'} ${shares(f.filledQuantity)} @ ${money(f.filledPrice)}`,
  }))
  const holders = p.bots.map((h) => ({ ...h, bot: bots.find((b) => b.id === h.botId) })).filter((h) => h.bot)
  const botName = (id) => (id ? bots.find((b) => b.id === id)?.name ?? 'Stopped bot' : 'Manual')

  return (
    <div className="tl-detail-inner" data-testid={`holding-detail-${sym}`}>
      <p className="tl-detail-summary">
        <strong>{shares(p.quantity)} {sym}</strong> · avg {money(p.avgPrice)} · {sessionDate(p.priceSession)} close {money(p.price)} ·{' '}
        <span className={tone(p.unrealizedPnl)}>{signedMoney(p.unrealizedPnl)} ({signedPct(p.unrealizedPct, 1)})</span>
        {p.weight !== null && <span className="tl-muted"> · {p.weight.toFixed(1)}% of portfolio</span>}
      </p>

      <div className="tl-chart-head">
        <h4 style={{ margin: 0 }}>Daily close</h4>
        <div className="tl-seg" role="group" aria-label="Price range">
          {RANGES.map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>)}
        </div>
      </div>
      {prices.status === 'loading' && prices.points.length === 0 ? (
        <span className="tl-skel" style={{ height: 180 }} />
      ) : prices.points.length === 0 ? (
        <div className="tl-chart-empty" style={{ height: 180 }}>Price history for {sym} isn’t available right now.</div>
      ) : (
        <ValueChart points={prices.points} markers={markers} height={180} label={`${sym} daily closes`} />
      )}
      <p className="tl-chart-caption">Daily closes · dots mark your fills.</p>

      <div className="tl-detail-grid" style={{ marginTop: 6 }}>
        <div>
          <h4>Research</h4>
          <ResearchCard symbol={sym} />
        </div>
        <div>
          <h4>{holders.length ? `Bots holding ${sym}` : 'Bots'}</h4>
          {holders.length === 0 ? (
            <p className="tl-small tl-muted m0">No running bot holds this position.</p>
          ) : (
            <ul className="tl-list">
              {holders.map(({ bot, quantity }) => (
                <li key={bot.id} className="tl-mini-row">
                  <span>
                    <Link to={`/bots/${bot.id}`} state={{ from: 'home' }}>{bot.name}</Link>
                    <span className="tl-sub">{plural(quantity, 'share')} · {STATUS_LABELS[bot.status] ?? bot.status}</span>
                  </span>
                  {!bot.stopped && (
                    <button type="button" className="tl-btn tl-btn--sm" onClick={() => onToggleBot(bot)} disabled={busy[bot.id]} aria-label={`${bot.running ? 'Pause' : 'Resume'} ${bot.name}`}>
                      {busy[bot.id] ? 'Saving…' : bot.running ? 'Pause' : 'Resume'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="tl-detail-actions">
            <Link className="tl-btn tl-btn--sm" to={`/bots/new?ticker=${encodeURIComponent(sym)}`}>Build a bot for {sym}</Link>
          </div>
        </div>
      </div>

      {fills && fills.length > 0 && (
        <ul className="tl-fill-list" data-testid="holding-fills">
          {fills.slice(0, 5).map((f) => (
            <li key={f.id}>
              {f.side === 'sell' ? 'Sold' : 'Bought'} {shares(f.filledQuantity)} @ {money(f.filledPrice)}
              <span className="tl-muted"> · {f.replaySession ? (f.simKind === 'daily' ? `${sessionDate(f.replaySession)} close` : `replay of ${sessionDate(f.replaySession)}`) : sessionDate(f.filledAt)} · {botName(f.botId)}</span>
            </li>
          ))}
          {fills.length > 5 && <li className="tl-muted">+{fills.length - 5} more in Activity</li>}
        </ul>
      )}
    </div>
  )
}
