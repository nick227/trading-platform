import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { loadStrategyLeaderboard } from './strategiesApi'
import { pct, signedPct, tone } from '../../ui/format'
import { buildLeaderboardNarrativeSummary } from '../../ui/narrativeSummaries'

function LeaderboardLink({ to, className, children, ...rest }) {
  const navigate = useNavigate()
  return (
    <a
      href={to}
      className={className}
      onClick={e => {
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}

function appendSymbolQuery(href, symbol) {
  if (!href || !symbol) return href
  const sep = href.includes('?') ? '&' : '?'
  return `${href}${sep}symbol=${encodeURIComponent(symbol)}`
}

function resolveRowAction(row, symbol) {
  if (row.category === 'rule_based' && row.id?.startsWith('platform:')) {
    const templateId = row.id.slice('platform:'.length)
    return {
      label: symbol ? `Automate ${symbol} →` : 'Customize →',
      href: `/bots/new?template=${encodeURIComponent(templateId)}${symbol ? `&ticker=${encodeURIComponent(symbol)}` : ''}`
    }
  }
  if (row.category === 'research_partner') {
    return {
      label: 'Research Partner →',
      href: appendSymbolQuery(row.href || '/research-partners', symbol)
    }
  }
  if (row.category === 'flagship_ai') {
    return {
      label: 'Inspect AI Trader →',
      href: row.href || '/ai-stock-trader'
    }
  }
  return {
    label: 'Inspect →',
    href: appendSymbolQuery(row.href || '/strategies', symbol)
  }
}

export default function StrategyLeaderboard({ initialData = null, symbolContext = null }) {
  const location = useLocation()
  const searchParams = new URLSearchParams(location?.search || '')
  const activeSymbol = symbolContext || (searchParams.get('symbol') || searchParams.get('ticker') || '').trim().toUpperCase() || null
  const [track, setTrack] = useState(initialData?.track || 'overview')
  const [category, setCategory] = useState('all')
  const [sortBy, setSortBy] = useState('risk_adjusted')
  const [state, setState] = useState(
    initialData ? { status: 'done', board: initialData } : { status: 'loading', board: null }
  )

  const fetchBoard = useCallback((nextTrack, nextCategory, nextSort) => {
    setState(s => ({ ...s, status: 'loading' }))
    loadStrategyLeaderboard({ track: nextTrack, category: nextCategory, sortBy: nextSort })
      .then(board => setState({ status: 'done', board }))
      .catch(() => setState({ status: 'error', board: null }))
  }, [])

  useEffect(() => {
    if (initialData && track === initialData.track && category === 'all' && sortBy === 'risk_adjusted') {
      return
    }
    fetchBoard(track, category, sortBy)
  }, [track, category, sortBy, fetchBoard, initialData])

  if (state.status === 'done' && !state.board) return null

  const board = state.board
  const currentTrackMeta = board?.tracks?.find(t => t.id === track)
  const narrative = buildLeaderboardNarrativeSummary(board)

  return (
    <section
      className="tl-card tl-card-shell tl-card-shell--compact"
      style={{ marginBottom: '1.5rem' }}
      aria-labelledby="cross-strategy-leaderboard-heading"
      data-testid="cross-strategy-leaderboard"
    >
      <div className="tl-section-head">
        <div>
          <h2 id="cross-strategy-leaderboard-heading" className="tl-section-title" style={{ margin: 0 }}>
            Cross-strategy leaderboard
          </h2>
          {narrative ? (
            <p className="tl-small" style={{ margin: '0.35rem 0 0' }} data-testid="strategies-narrative-summary">
              {narrative}
            </p>
          ) : (
            <p className="tl-small tl-muted" style={{ margin: '0.25rem 0 0' }}>
              Side-by-side comparison of rule-based templates, Research Partner forward strategies, and the Flagship AI Trader on standardized risk-adjusted return, drawdown, and sample size.
            </p>
          )}
        </div>
        {board?.summary && (
          <span className="tl-tag" data-testid="leaderboard-evaluated-count">
            {board.summary.evaluatedCount} ranked · {board.summary.totalStrategies} total
          </span>
        )}
      </div>

      {state.status === 'loading' && !board && (
        <p className="tl-small tl-muted" style={{ marginTop: '0.5rem' }} role="status">Loading standardized strategy comparison…</p>
      )}
      {state.status === 'error' && (
        <p className="tl-small tl-neg" style={{ marginTop: '0.5rem' }} role="alert">Cross-strategy leaderboard is temporarily unavailable.</p>
      )}

      <details className="tl-flow-card" style={{ marginTop: '0.75rem' }} data-testid="leaderboard-details-disclosure">
        <summary><strong>Inspect details · Full leaderboard comparison &amp; filters</strong></summary>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', margin: '0.85rem 0 0.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }} role="group" aria-label="Evaluation horizon">
          {[
            { id: 'overview', label: 'All horizons' },
            { id: 'forward', label: 'Forward paper' },
            { id: '1Y', label: '1Y backtest' },
            { id: '5Y', label: '5Y backtest' }
          ].map(item => (
            <button
              key={item.id}
              type="button"
              className={`tl-tag ${track === item.id ? 'is-active' : ''}`}
              aria-pressed={track === item.id}
              onClick={() => setTrack(item.id)}
              data-testid={`leaderboard-track-${item.id}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="tl-small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>Family:</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            aria-label="Filter by strategy family"
            data-testid="leaderboard-filter-category"
          >
            <option value="all">All families</option>
            <option value="rule_based">Rule-Based</option>
            <option value="flagship_ai">Flagship AI</option>
            <option value="research_partner">Research Partner</option>
            <option value="ai_strategy">AI Momentum</option>
          </select>
        </label>

        <label className="tl-small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>Rank by:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            aria-label="Sort leaderboard"
            data-testid="leaderboard-sort"
          >
            <option value="risk_adjusted">Risk-adjusted (Return / DD)</option>
            <option value="total_return">Total return %</option>
            <option value="excess_return">Excess vs benchmark %</option>
            <option value="lowest_drawdown">Lowest drawdown %</option>
          </select>
        </label>
      </div>

      {currentTrackMeta?.description && (
        <p className="tl-small tl-muted" style={{ margin: '0 0 0.75rem' }}>
          {currentTrackMeta.description}
        </p>
      )}

      {state.status === 'loading' && !board && (
        <p className="tl-small tl-muted" role="status">Loading standardized strategy comparison…</p>
      )}
      {state.status === 'error' && (
        <p className="tl-small tl-neg" role="alert">Cross-strategy leaderboard is temporarily unavailable.</p>
      )}

      {board && (
        <div style={{ overflowX: 'auto' }}>
          <table className="tl-table" data-testid="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Strategy</th>
                <th>Family</th>
                <th>Horizon</th>
                <th className="r">Return</th>
                <th className="r">vs Bench</th>
                <th className="r">Max DD</th>
                <th className="r">Return / DD</th>
                <th>Sample size</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {board.entries.map(row => {
                const action = resolveRowAction(row, activeSymbol)
                const detailHref = appendSymbolQuery(row.href, activeSymbol)
                return (
                <tr key={row.id} data-testid={`leaderboard-row-${row.id}`}>
                  <td><strong>{row.rank != null ? `#${row.rank}` : '—'}</strong></td>
                  <td>
                    <LeaderboardLink to={detailHref}><strong>{row.name}</strong></LeaderboardLink>
                    {row.statusNote && <div className="tl-small tl-muted">{row.statusNote}</div>}
                  </td>
                  <td><span className="tl-tag">{row.categoryLabel}</span></td>
                  <td className="tl-small">{row.horizon}</td>
                  <td className={`r ${tone(row.returnPct)}`}>
                    {row.returnPct != null ? signedPct(row.returnPct) : '—'}
                  </td>
                  <td className={`r ${tone(row.excessVsBenchmarkPct)}`}>
                    {row.excessVsBenchmarkPct != null ? signedPct(row.excessVsBenchmarkPct) : '—'}
                  </td>
                  <td className="r">
                    {row.maxDrawdownPct != null ? `−${pct(row.maxDrawdownPct, 2)}` : '—'}
                  </td>
                  <td className={`r ${tone(row.riskAdjustedScore)}`}>
                    {row.riskAdjustedScore != null ? `${row.riskAdjustedScore.toFixed(2)}x` : '—'}
                  </td>
                  <td className="tl-small">
                    <div>{row.sampleSize?.label || '—'}</div>
                    <div className="tl-muted">
                      {row.sampleSize?.tradesCount ?? 0} trade(s)
                      {row.sampleSize?.sessionsCount > 0 ? ` · ${row.sampleSize.sessionsCount}d` : ''}
                      {row.sampleSize?.symbolsTested ? ` · ${row.sampleSize.symbolsTested} sym` : ''}
                    </div>
                  </td>
                  <td className="tl-small">
                    <LeaderboardLink to={action.href} className="tl-link-btn" data-testid={`leaderboard-action-${row.id}`}>
                      {action.label}
                    </LeaderboardLink>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {board?.methodologyNote && (
        <p className="tl-small tl-muted" style={{ margin: '0.75rem 0 0' }} data-testid="leaderboard-methodology">
          {board.methodologyNote}
        </p>
      )}
      </details>
    </section>
  )
}
