import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { money, signedPct, sessionDate, ratioPct, tone } from '../../ui/format'

function SpaLink({ to, className, children }) {
  const navigate = useNavigate()
  return (
    <a
      href={to}
      className={className}
      onClick={e => {
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

export default function StockDiscoveryPanel({ discovery, compact = false }) {
  const [selectedSector, setSelectedSector] = useState('all')
  const [selectedTheme, setSelectedTheme] = useState('all')
  const [beyondOnly, setBeyondOnly] = useState(false)

  const filtered = useMemo(() => {
    const items = discovery?.discoveries || []
    return items.filter(item => {
      if (selectedSector !== 'all' && item.sector !== selectedSector) return false
      if (selectedTheme !== 'all' && item.theme !== selectedTheme) return false
      if (beyondOnly && !item.beyondWatchlist) return false
      return true
    })
  }, [discovery, selectedSector, selectedTheme, beyondOnly])

  if (!discovery) return null

  const leadingSector = discovery.sectors?.[0]

  return (
    <section className="tl-section" aria-labelledby="ai-discovery-heading" data-testid="ai-stock-discovery">
      <div className="tl-section-head">
        <div>
          <h2 id="ai-discovery-heading" className="tl-section-title">Autonomous stock discovery</h2>
          <p className="tl-section-note">
            Scans {discovery.universeScanned ?? 0} companies across {discovery.sectorsCount ?? 0} sectors beyond the static 10-ticker watchlist, combining deterministic relative strength with verified SEC filings and market news as of {sessionDate(discovery.asOfSession, { year: true })}.
          </p>
        </div>
        {compact && <SpaLink to="/opportunities" className="tl-link-btn">Open full discovery explorer →</SpaLink>}
      </div>

      <dl className="tl-stats tl-stats--3 tl-stat-grid--flush" data-testid="discovery-summary-stats">
        <div className="tl-stat">
          <dt>Companies qualified</dt>
          <dd>
            {discovery.eligibleCompaniesCount ?? 0}
            <small>{discovery.beyondWatchlistCount ?? 0} beyond default watchlist</small>
          </dd>
        </div>
        <div className="tl-stat">
          <dt>Leading sector</dt>
          <dd>
            {leadingSector ? leadingSector.sector : '—'}
            <small>{leadingSector ? `${leadingSector.breadthPct}% 20d breadth · Leader ${leadingSector.leaderSymbol}` : 'Insufficient session data'}</small>
          </dd>
        </div>
        <div className="tl-stat">
          <dt>Market benchmark (SPY)</dt>
          <dd>
            <span className={tone(discovery.benchmark?.return20dPct)}>{signedPct(discovery.benchmark?.return20dPct)}</span>
            <small>20d return · Regime: {discovery.benchmark?.regime || 'unknown'}</small>
          </dd>
        </div>
      </dl>

      {discovery.sectors?.length > 0 && (
        <div className="tl-flow-card" data-testid="discovery-sector-strip">
          <p className="tl-small"><strong>Sector breadth &amp; leadership</strong> — filter opportunities by sector:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className={`tl-tag ${selectedSector === 'all' ? 'is-active' : ''}`}
              onClick={() => setSelectedSector('all')}
              aria-pressed={selectedSector === 'all'}
            >
              All sectors ({discovery.discoveries?.length ?? 0})
            </button>
            {discovery.sectors.map(sec => (
              <button
                key={sec.sector}
                type="button"
                className={`tl-tag ${selectedSector === sec.sector ? 'is-active' : ''}`}
                onClick={() => setSelectedSector(sec.sector)}
                aria-pressed={selectedSector === sec.sector}
              >
                {sec.sector} · {sec.breadthPct}% breadth ({sec.leaderSymbol})
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', margin: '0.75rem 0' }}>
        <label className="tl-small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={beyondOnly}
            onChange={e => setBeyondOnly(e.target.checked)}
            data-testid="filter-beyond-watchlist"
          />
          <span>Beyond 10-stock watchlist only</span>
        </label>

        <label className="tl-small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span>Signal theme:</span>
          <select
            value={selectedTheme}
            onChange={e => setSelectedTheme(e.target.value)}
            aria-label="Filter by signal theme"
            data-testid="filter-discovery-theme"
          >
            <option value="all">All themes</option>
            {(discovery.themes || []).map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="tl-muted" data-testid="discovery-empty">No discovered companies match the current sector or theme filter.</p>
      ) : (
        <div className="tl-ai-feed" data-testid="discovery-candidates-list">
          {filtered.slice(0, compact ? 8 : 30).map(item => (
            <article key={item.symbol} className="tl-card tl-card-shell tl-card-shell--compact" data-testid={`discovery-card-${item.symbol}`}>
              <div className="tl-section-head">
                <div>
                  <h3>
                    <SpaLink to={`/assets/${encodeURIComponent(item.symbol)}`}>{item.symbol}</SpaLink>
                    {' · '}
                    <span>{item.name}</span>
                  </h3>
                  <p className="tl-small tl-muted">
                    {item.sector} · {item.industry}
                    {item.beyondWatchlist ? ' · Emerged beyond default watchlist' : ' · Core benchmark watchlist'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {item.beyondWatchlist && <span className="tl-tag">New discovery</span>}
                  <span className="tl-tag">{item.themeLabel}</span>
                  <span className="tl-tag">Score {item.discoveryScore}</span>
                </div>
              </div>

              <p className="tl-small">
                <strong>Last close:</strong> {money(item.indicators?.price)}
                {' · '}
                <strong>5d:</strong> <span className={tone(item.indicators?.return5dPct)}>{signedPct(item.indicators?.return5dPct)}</span>
                {' · '}
                <strong>20d:</strong> <span className={tone(item.indicators?.return20dPct)}>{signedPct(item.indicators?.return20dPct)}</span>
                {' · '}
                <strong>vs SPY (20d):</strong> <span className={tone(item.rs20dPct)}>{signedPct(item.rs20dPct)}</span>
                {' · '}
                <strong>Volume:</strong> {item.indicators?.volumeRatio ? `${item.indicators.volumeRatio.toFixed(2)}x` : '—'}
              </p>

              {item.latestAiDecision && (
                <p className="tl-small">
                  <strong>Flagship AI stance ({sessionDate(item.latestAiDecision.asOfSession)}):</strong>{' '}
                  <span className={item.latestAiDecision.action === 'BUY' ? 'tl-pos' : item.latestAiDecision.action === 'SELL' ? 'tl-neg' : 'tl-muted'}>
                    {item.latestAiDecision.action}
                  </span>
                  {item.latestAiDecision.confidence != null && ` · Conviction ${ratioPct(item.latestAiDecision.confidence, 0)}`}
                </p>
              )}

              {item.whyItMatters?.length > 0 && (
                <ul className="tl-backtest-notes">
                  {item.whyItMatters.map((point, idx) => <li key={idx}>{point}</li>)}
                </ul>
              )}

              {item.qualitativeEvidence?.length > 0 && (
                <details className="tl-flow-card">
                  <summary>
                    <strong>Supporting qualitative evidence ({item.qualitativeEvidence.length})</strong>
                    {' · '}
                    {item.evidenceCounts?.filings > 0 ? `${item.evidenceCounts.filings} verified SEC filing(s)` : ''}
                    {item.evidenceCounts?.filings > 0 && item.evidenceCounts?.news > 0 ? ', ' : ''}
                    {item.evidenceCounts?.news > 0 ? `${item.evidenceCounts.news} reported news item(s)` : ''}
                  </summary>
                  <ul className="tl-backtest-notes">
                    {item.qualitativeEvidence.map(ev => (
                      <li key={ev.id}>
                        <strong>[{ev.sourceId === 'filings' ? `SEC ${ev.filingType}` : 'News'} · {sessionDate(ev.publishedAt)}]</strong>{' '}
                        {ev.summary}{' '}
                        {ev.url && (
                          <a href={ev.url} target="_blank" rel="noopener noreferrer">
                            Source ↗
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {item.risksToWatch?.length > 0 && (
                <p className="tl-small tl-muted">What to verify / risks: {item.risksToWatch.join(' ')}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
