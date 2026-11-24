import { useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../../../api/client'
import Disclosure from '../../../ui/Disclosure'
import { moneyWhole, signedMoney, tone } from '../../../ui/format'

const pct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`)
const COLUMNS = [
  { id: 'paperReturn', label: 'Return', value: (r) => r.paper.returnPct, render: (r) => <span className={tone(r.paper.returnPct)}>{pct(r.paper.returnPct)}</span> },
  { id: 'pnl', label: 'P&L', value: (r) => r.paper.totalPnl, render: (r) => <span className={tone(r.paper.totalPnl)}>{r.paper.totalPnl === null ? '—' : signedMoney(r.paper.totalPnl)}</span> },
  { id: 'winRate', label: 'Win rate', hideSm: true, value: (r) => r.paper.winRate, render: (r) => (r.paper.winRate === null ? '—' : `${Math.round(r.paper.winRate * 100)}% of ${r.paper.closedTrades}`) },
  { id: 'drawdown', label: 'Max drawdown', hideSm: true, value: (r) => (r.paper.maxDrawdown ? -r.paper.maxDrawdown.pct : 0), render: (r) => (r.paper.maxDrawdown ? `${r.paper.maxDrawdown.pct.toFixed(2)}%` : '—') },
  { id: 'inUse', label: 'Capital in use', hideSm: true, value: (r) => r.paper.capitalInUse, render: (r) => (r.paper.capitalInUse === null ? '—' : `${moneyWhole(r.paper.capitalInUse)}${r.allocation ? ` / ${moneyWhole(r.allocation)}` : ''}`) },
  { id: 'backtest', label: 'Backtest', value: (r) => r.backtest?.returnPct ?? null, render: (r) => (r.backtest
    ? <span title={`${r.backtest.range.start} – ${r.backtest.range.end} · buy & hold ${pct(r.backtest.buyAndHoldReturnPct)}`}><span className={tone(r.backtest.returnPct)}>{pct(r.backtest.returnPct)}</span><span className="tl-muted tl-small"> vs {pct(r.backtest.buyAndHoldReturnPct)}</span></span>
    : <span className="tl-muted">—</span>) },
]

/** Bots side by side: paper results (same numbers as each bot page) and their latest backtest. */
export function CompareTable({ rows }) {
  const [sort, setSort] = useState({ id: 'paperReturn', dir: -1 })
  const col = COLUMNS.find((c) => c.id === sort.id)
  const sorted = [...rows].sort((a, b) => {
    const va = col.value(a), vb = col.value(b)
    if (va === null || va === undefined) return 1
    if (vb === null || vb === undefined) return -1
    return (va - vb) * sort.dir
  })
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tl-table" data-testid="compare-table">
        <thead>
          <tr>
            <th>Bot</th>
            {COLUMNS.map((c) => (
              <th key={c.id} className={`r${c.hideSm ? ' tl-hide-sm' : ''}`} aria-sort={sort.id === c.id ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'}>
                <button type="button" className="tl-link-btn tl-small" onClick={() => setSort((s) => ({ id: c.id, dir: s.id === c.id ? -s.dir : -1 }))}>{c.label}{sort.id === c.id ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} data-testid="compare-row">
              <td>
                <Link to={`/bots/${r.id}`}>{r.name}</Link>
                <div className="tl-small tl-muted">{r.symbols.join(', ')}{r.enabled ? '' : ' · paused'}{r.clonedFrom ? ` · copy of ${r.clonedFrom.name}` : ''}</div>
              </td>
              {COLUMNS.map((c) => <td key={c.id} className={`r${c.hideSm ? ' tl-hide-sm' : ''}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tl-small tl-muted">Return is P&amp;L on each bot’s capital over its paper trading (last year). Backtests are hypothetical past results, shown against buy &amp; hold of the same symbols.</p>
    </div>
  )
}

export default function CompareBots() {
  const [state, setState] = useState({ status: 'idle', rows: null })
  const load = () => {
    if (state.status !== 'idle') return
    setState({ status: 'loading', rows: null })
    get('/bots/compare').then((rows) => setState({ status: 'done', rows: Array.isArray(rows) ? rows : [] }))
      .catch(() => setState({ status: 'error', rows: null }))
  }
  return (
    <Disclosure label="Compare bots" meta="paper results and backtests side by side" onOpen={load} testId="compare-bots">
      {state.status === 'loading' && <span className="tl-skel" style={{ height: 120 }} aria-label="Loading comparison" />}
      {state.status === 'error' && <p className="tl-neg tl-small" role="alert">The comparison couldn’t be loaded.</p>}
      {state.status === 'done' && <CompareTable rows={state.rows} />}
    </Disclosure>
  )
}
