import { useMemo } from 'react'
import { fmtPercent, fmtDays } from '../assets/utils.js'
import { CARD_STYLE, SENTIMENT_COLORS } from './constants.js'

export default function StrategyPerformanceCard({ executions, strategies }) {
  const rows = useMemo(() => {
    const executionsList = Array.isArray(executions) ? executions : []
    const strategyList   = Array.isArray(strategies)  ? strategies  : []

    const counts = new Map()
    for (const exec of executionsList) {
      const sid = exec?.strategyId ?? exec?.strategy_id ?? null
      if (!sid) continue
      const s = String(exec?.status ?? '').toLowerCase()
      if (s && s !== 'filled' && s !== 'partially_filled') continue
      counts.set(sid, (counts.get(sid) ?? 0) + 1)
    }

    const byId = new Map()
    for (const strat of strategyList) {
      const id = strat?.id ?? strat?.strategyId ?? strat?.strategy_id ?? null
      if (id) byId.set(id, strat)
    }

    const result = []
    for (const id of new Set([...counts.keys(), ...byId.keys()])) {
      const strat      = byId.get(id) ?? {}
      const trades     = counts.get(id) ?? 0
      const winRateRaw = strat?.win_rate ?? strat?.winRate ?? strat?.winrate ?? null
      const edgeRaw    = strat?.edge ?? strat?.return ?? strat?.roi ?? null
      const holdRaw    = strat?.avg_hold_days ?? strat?.avgHoldDays ?? strat?.avg_hold ?? strat?.avgHold ?? null
      const statusRaw  = strat?.status ?? strat?.state ?? null
      result.push({
        id:      String(id),
        name:    strat?.name ?? strat?.title ?? (typeof id === 'string' ? `Strategy ${id.slice(0, 8)}` : 'Strategy'),
        trades,
        edge:    typeof edgeRaw    === 'string' && edgeRaw.trim()    ? edgeRaw.trim()    : fmtPercent(edgeRaw, 1),
        winRate: typeof winRateRaw === 'string' && winRateRaw.trim() ? winRateRaw.trim() : fmtPercent(winRateRaw, 0),
        avgHold: typeof holdRaw    === 'string' && holdRaw.trim()    ? holdRaw.trim()    : fmtDays(holdRaw),
        status:  typeof statusRaw  === 'string' && statusRaw.trim()  ? statusRaw.trim().toUpperCase() : trades > 0 ? 'ACTIVE' : 'IDLE',
      })
    }

    return result.sort((a, b) => (b.trades ?? 0) - (a.trades ?? 0)).slice(0, 12)
  }, [executions, strategies])

  return (
    <article style={CARD_STYLE}>
      <strong>Strategy Performance</strong>
      <div style={{ marginTop: '0.8rem', maxHeight: 300, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>No strategy stats available yet.</div>
        ) : rows.map((s) => (
          <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '0.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.5rem', alignItems: 'center', fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div className="muted">{s.trades} trades</div>
            </div>
            <div style={{ color: SENTIMENT_COLORS.bullish, fontWeight: 700 }}>{s.edge}</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600 }}>{s.winRate}</div>
              <div className="muted">Win Rate</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600 }}>{s.avgHold}</div>
              <div className="muted">Avg Hold</div>
            </div>
            <div>
              <span style={{ backgroundColor: s.status === 'ACTIVE' ? SENTIMENT_COLORS.bullish : SENTIMENT_COLORS.danger, color: 'white', padding: '2px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600 }}>
                {s.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}
