import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../../api/client'
import { normalizeExecution } from '../../api/services/botDashboardService'
import ValueChart from '../../ui/ValueChart'
import { money, plural, sessionDate, shares, signedMoney, signedPct, tone } from '../../ui/format'
import { loadPriceHistory } from './homeApi'

const RANGES = ['1M', '3M', '1Y']

/** Inline detail for one holding: price + fills, position, bots, transactions, actions. */
export default function HoldingDetail({ position, bots, busy, onToggleBot }) {
  const sym = position.symbol
  const [range, setRange] = useState('3M')
  const [prices, setPrices] = useState({ status: 'loading', points: [] })
  const [fills, setFills] = useState(null)

  useEffect(() => {
    let live = true
    setPrices((p) => ({ ...p, status: 'loading' }))
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
  const holders = position.bots.map((h) => ({ ...h, bot: bots.find((b) => b.id === h.botId) })).filter((h) => h.bot)
  const botName = (id) => (id ? bots.find((b) => b.id === id)?.name ?? 'Stopped bot' : 'Manual')

  return (
    <div className="tl-detail-inner" data-testid={`holding-detail-${sym}`}>
      <div className="tl-detail-grid">
        <div>
          <div className="tl-chart-head" style={{ marginTop: 12 }}>
            <h4 style={{ margin: 0 }}>{sym} daily close</h4>
            <div className="tl-seg" role="group" aria-label="Price range">
              {RANGES.map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>)}
            </div>
          </div>
          {prices.status === 'loading' && prices.points.length === 0 ? (
            <span className="tl-skel" style={{ height: 180 }} />
          ) : prices.points.length === 0 ? (
            <div className="tl-chart-empty" style={{ height: 180 }}>Price history for {sym} isn’t available right now.</div>
          ) : (
            <ValueChart points={prices.points} markers={markers} height={180} tone="neutral" label={`${sym} daily closes`} />
          )}
          <p className="tl-chart-caption">
            Alpha Engine daily closes. <span className="tl-pos">●</span> your buys{markers.some((m) => m.kind === 'sell') && <> · <span className="tl-neg">●</span> sells</>}.
          </p>
        </div>
        <div>
          <h4>Position</h4>
          <dl className="tl-facts">
            <dt>Shares</dt><dd>{shares(position.quantity)}</dd>
            <dt>Average cost</dt><dd>{money(position.avgPrice)}</dd>
            <dt>Cost basis</dt><dd>{money(position.costBasis)}</dd>
            <dt>Last close</dt><dd>{money(position.price)} <span className="tl-muted">{position.priceSession ? sessionDate(position.priceSession) : ''}</span></dd>
            <dt>Market value</dt><dd>{money(position.marketValue)}</dd>
            <dt>Unrealized</dt><dd className={tone(position.unrealizedPnl)}>{signedMoney(position.unrealizedPnl)} <span>{position.unrealizedPct !== null ? `(${signedPct(position.unrealizedPct, 1)})` : ''}</span></dd>
            <dt>Of portfolio</dt><dd>{position.weight !== null ? `${position.weight.toFixed(1)}%` : '—'}</dd>
          </dl>
        </div>
      </div>

      <div className="tl-detail-grid">
        <div>
          <h4>Transactions</h4>
          {fills === null ? (
            <span className="tl-skel" style={{ height: 60 }} />
          ) : fills.length === 0 ? (
            <p className="tl-muted tl-small">No fills recorded for {sym}.</p>
          ) : (
            <table className="tl-table tl-small">
              <tbody>
                {fills.slice(0, 6).map((f) => (
                  <tr key={f.id}>
                    <td>{f.side === 'sell' ? 'Sold' : 'Bought'} {shares(f.filledQuantity)} <span className="tl-sub">{botName(f.botId)}</span></td>
                    <td className="r">{money(f.filledPrice)}<span className="tl-sub">{f.replaySession ? `Replay of ${sessionDate(f.replaySession)}` : sessionDate(f.filledAt)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h4>{holders.length ? `Bots holding ${sym}` : 'Bots'}</h4>
          {holders.length === 0 ? (
            <p className="tl-muted tl-small">No bot holds this position.</p>
          ) : (
            <ul className="tl-list">
              {holders.map(({ bot, quantity }) => (
                <li key={bot.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                  <span>
                    <Link to={`/bots/${bot.id}`} state={{ from: 'home' }}>{bot.name}</Link>
                    <span className="tl-sub">{plural(quantity, 'share')} · <span className={`tl-status tl-status--${bot.status}`} style={{ fontSize: 12.5 }}>{bot.status === 'running' ? 'Running' : bot.status === 'paused' ? 'Paused' : bot.status}</span></span>
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
            <Link className="tl-btn tl-btn--sm" to={`/bots/new?ticker=${encodeURIComponent(sym)}`}>Create a bot for {sym}</Link>
            <Link className="tl-btn tl-btn--sm tl-btn--quiet" to={`/assets/${encodeURIComponent(sym)}`}>Research {sym} →</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
