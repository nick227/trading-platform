import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { get } from '../../api/client'
import { normalizeValuation, normalizeBot } from './homeApi'
import { useBotControls } from '../../ui/useBotControls'
import { money, sessionDate, shares, signedMoney, signedPct, tone } from '../../ui/format'
import HoldingDetail from './HoldingDetail'
import './portfolio-page.css'

const COLUMNS = [
  { id: 'symbol', label: 'Investment', numeric: false },
  { id: 'quantity', label: 'Shares', numeric: true },
  { id: 'price', label: 'Last price', numeric: true },
  { id: 'marketValue', label: 'Value', numeric: true },
  { id: 'unrealizedPnl', label: 'Gain / loss', numeric: true },
]

/** An intentionally small portfolio request; bot activity belongs to its own workspace. */
async function loadPortfolio() {
  const [valuationResult, botsResult] = await Promise.allSettled([
    get('/account/valuation'), get('/bots'),
  ])
  const valuation = valuationResult.status === 'fulfilled'
    ? normalizeValuation(valuationResult.value) : null
  const raw = botsResult.status === 'fulfilled'
    ? (Array.isArray(botsResult.value) ? botsResult.value : botsResult.value?.data ?? []) : []
  return {
    valuation,
    valuationError: valuationResult.status === 'rejected' ? 'Portfolio figures are temporarily unavailable.' : null,
    bots: Array.isArray(raw) ? raw.map(bot => normalizeBot(bot)) : [],
  }
}

export function sortPortfolioPositions(positions, column, direction = 'desc') {
  const numeric = COLUMNS.find(item => item.id === column)?.numeric
  const multiplier = direction === 'asc' ? 1 : -1
  return [...positions].sort((a, b) => {
    const av = a[column]
    const bv = b[column]
    // Missing market prices stay last, whether ascending or descending.
    if (av == null && bv != null) return 1
    if (bv == null && av != null) return -1
    if (av == null && bv == null) return a.symbol.localeCompare(b.symbol)
    const compare = numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv))
    return (compare || a.symbol.localeCompare(b.symbol)) * multiplier
  })
}

function Metric({ title, value }) {
  return <div className="tl-portfolio-metric">
    <dt>{title}</dt><dd className="tl-num">{value}</dd>
  </div>
}

export default function PortfolioPage() {
  const [params] = useSearchParams()
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [sort, setSort] = useState({ column: 'marketValue', direction: 'desc' })
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    setState(current => ({ ...current, status: 'loading' }))
    try {
      const data = await loadPortfolio()
      setState({ status: 'ready', data, error: null })
    } catch (error) {
      setState({ status: 'error', data: null, error: error.message || 'Portfolio unavailable' })
    }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const holding = params.get('holding')
    if (holding) setOpen(holding.toUpperCase())
  }, [params])

  const controls = useBotControls(fn => setState(current => current.data
    ? { ...current, data: { ...current.data, bots: fn(current.data.bots) } } : current))

  const data = state.data
  const v = data?.valuation
  const positions = v?.positions ?? []
  const sorted = useMemo(() => sortPortfolioPositions(positions, sort.column, sort.direction), [positions, sort])
  const hasReturns = v?.fillCount > 0 && v.totalPnl != null
  const chooseSort = column => setSort(current => ({
    column, direction: current.column === column && current.direction === 'desc' ? 'asc' : 'desc',
  }))

  return <main className="tl-page tl-portfolio-page" data-testid="portfolio-page">
    <header className="tl-portfolio-header">
      <div>
        <h1>Portfolio</h1>
        <p>Your investments and their recorded performance.</p>
      </div>
      <button className="tl-btn tl-btn--secondary" type="button" onClick={load}
        disabled={state.status === 'loading'}>Refresh</button>
    </header>

    {state.status === 'loading' && !data && <p role="status">Loading portfolio…</p>}
    {state.status === 'error' && <div role="alert" className="tl-content-state tl-content-state--error">
      <strong>{state.error}</strong><button className="tl-btn tl-btn--secondary" onClick={load}>Retry</button>
    </div>}

    {data && <>
      <section aria-labelledby="portfolio-balance-title" className="tl-portfolio-summary">
        <p className="tl-portfolio-overline" id="portfolio-balance-title">
          {v?.simulated ? 'Simulated portfolio value' : 'Total portfolio value'}
        </p>
        <div className="tl-portfolio-equity tl-num" data-testid="balance-equity">{v?.source !== 'none' && v?.equity != null ? money(v.equity) : '—'}</div>
        {hasReturns && <p className={`tl-portfolio-return ${tone(v.totalPnl)}`} data-testid="portfolio-total-pnl">
          {signedMoney(v.totalPnl)} ({signedPct(v.totalPnlPct)}) <span>total return</span>
        </p>}
        {v?.fillCount === 0 && v.source !== 'none' && <p className="tl-portfolio-no-trades" data-testid="portfolio-all-cash">
          No completed trades yet. Your balance is currently held in cash.
        </p>}
        {v?.pricesAsOf && v.fillCount > 0 && <p className="tl-portfolio-valued-at" data-testid="as-of">
          Valued at {sessionDate(v.pricesAsOf)} closing prices{v.simulated && v.session
            ? (v.simMode === 'paper_daily' ? ' · simulated daily-close fills' : ` · simulated fills replay the ${sessionDate(v.session)} close`) : ''}
        </p>}
        {v?.equity == null && v?.unpricedSymbols?.length > 0 &&
          <p className="tl-portfolio-valued-at">Total unavailable because current prices are missing for {v.unpricedSymbols.join(', ')}.</p>}
        {data.valuationError && <p role="alert">{data.valuationError}</p>}
        {v?.source === 'none' && <p className="tl-portfolio-valued-at">
          No account balance is available. <Link to="/profile">Connect a paper account</Link>.
        </p>}
        {v && v.source !== 'none' && <dl className="tl-portfolio-metrics">
          <Metric title="Invested" value={money(v.marketValue)} />
          <Metric title="Available cash" value={money(v.cash)} />
          <Metric title="Holdings" value={positions.length} />
        </dl>}
      </section>

      {v && v.source !== 'none' && <section className="tl-portfolio-investments" id="holdings" aria-labelledby="portfolio-holdings-title">
        <div className="tl-portfolio-investments__head">
          <h2 id="portfolio-holdings-title">Investments</h2>
          <span>{positions.length} {positions.length === 1 ? 'holding' : 'holdings'}</span>
        </div>
        <div className="tl-portfolio-table-wrap">
          <table className="tl-portfolio-table" data-testid="holdings-table">
            <thead><tr>{COLUMNS.map(col => <th key={col.id}
              scope="col" aria-sort={sort.column === col.id ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              className={col.numeric ? 'is-numeric' : ''}>
              <button type="button" onClick={() => chooseSort(col.id)}
                aria-label={`Sort by ${col.label}`}>
                {col.label}<span aria-hidden="true" className="tl-portfolio-sort-mark">
                  {sort.column === col.id ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                </span>
              </button>
            </th>)}</tr></thead>
            <tbody>
              {!sorted.length ? <tr><td colSpan={COLUMNS.length} className="tl-portfolio-empty">
                <strong>No investments yet</strong>
                <p>Your holdings and returns will appear here after your first completed trade.</p>
              </td></tr> : sorted.map(p => {
                const expanded = open === p.symbol
                return <Fragment key={p.symbol}>
                  <tr className={expanded ? 'is-expanded' : ''} data-testid="holding-row">
                    <td><button type="button" className="tl-portfolio-symbol" aria-expanded={expanded}
                      aria-controls={`holding-detail-panel-${p.symbol}`}
                      onClick={() => setOpen(expanded ? null : p.symbol)}>
                      <strong>{p.symbol}</strong><span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
                    </button></td>
                    <td className="is-numeric tl-num">{shares(p.quantity)}</td>
                    <td className="is-numeric tl-num">{money(p.price)}</td>
                    <td className="is-numeric tl-num">{money(p.marketValue)}</td>
                    <td className={`is-numeric tl-num ${tone(p.unrealizedPnl)}`}>
                      {signedMoney(p.unrealizedPnl)}
                      <span className="tl-portfolio-return-pct">{signedPct(p.unrealizedPct, 1)}</span>
                    </td>
                  </tr>
                  {expanded && <tr><td colSpan={COLUMNS.length} className="tl-portfolio-holding-detail">
                    <div id={`holding-detail-panel-${p.symbol}`}>
                      <HoldingDetail position={p} bots={data.bots} busy={controls.busy} onToggleBot={controls.toggle} />
                    </div>
                  </td></tr>}
                </Fragment>
              })}
            </tbody>
          </table>
        </div>
      </section>}
      <p className="tl-portfolio-disclaimer">
        {v?.simulated ? 'Simulated account · Not a real-money brokerage balance.' :
          'Balances and prices are provided by your connected account.'}
      </p>
    </>}
  </main>
}
