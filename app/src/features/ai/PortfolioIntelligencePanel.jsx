import { money, pct, signedMoney, signedPct, shares, sessionDate, tone } from '../../ui/format'

export default function PortfolioIntelligencePanel({ intelligence }) {
  if (!intelligence || intelligence.status === 'not_initialized') return null

  const { summary, concentration, holdings = [], allocationProposals = [], marketRegime } = intelligence

  return (
    <section className="tl-section" aria-labelledby="portfolio-intel-heading" data-testid="portfolio-intelligence">
      <div className="tl-section-head">
        <div>
          <h2 id="portfolio-intel-heading" className="tl-section-title">Intelligent portfolio management</h2>
          <p className="tl-section-note">
            Evaluates open paper holdings, sector concentration, thesis health, and deterministic risk-bounded allocation adjustments as of {sessionDate(intelligence.asOfSession, { year: true })}.
          </p>
        </div>
        <span className="tl-tag">
          Regime: {marketRegime?.regime || 'unknown'} · {concentration?.diversificationStatus?.replace('_', ' ') || 'balanced'}
        </span>
      </div>

      <dl className="tl-stats tl-stats--3 tl-stat-grid--flush" data-testid="portfolio-intel-summary">
        <div className="tl-stat">
          <dt>Invested exposure</dt>
          <dd>
            {money(summary?.investedValue)}
            <small>{pct(summary?.grossExposurePct)} of paper equity · {summary?.openPositionsCount ?? 0} holding(s)</small>
          </dd>
        </div>
        <div className="tl-stat">
          <dt>Deployable paper cash</dt>
          <dd>
            {money(summary?.availableCash)}
            <small>{pct(summary?.cashWeightPct)} cash weight{summary?.reservedBuyCash > 0 ? ` (${money(summary.reservedBuyCash)} reserved)` : ''}</small>
          </dd>
        </div>
        <div className="tl-stat">
          <dt>Deterministic risk caps</dt>
          <dd>
            {pct(summary?.maxPositionPct, 0)} max / stock
            <small>{money(summary?.maxOrderNotional)} max per order</small>
          </dd>
        </div>
      </dl>

      {concentration?.sectorExposure?.length > 0 && (
        <div className="tl-flow-card" data-testid="portfolio-sector-exposure">
          <p className="tl-small"><strong>Sector concentration</strong> (HHI {concentration.hhi}):</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.4rem' }}>
            {concentration.sectorExposure.map(sec => (
              <span key={sec.sector} className="tl-tag">
                {sec.sector}: {pct(sec.weightPct)} ({sec.symbols.join(', ')})
              </span>
            ))}
          </div>
        </div>
      )}

      {concentration?.alerts?.length > 0 && (
        <div className="tl-flow-card" data-testid="portfolio-concentration-alerts">
          <p className="tl-small"><strong>Portfolio diagnostics</strong></p>
          <ul className="tl-backtest-notes">
            {concentration.alerts.map((alert, idx) => (
              <li key={idx}>{alert.message}</li>
            ))}
          </ul>
        </div>
      )}

      {holdings.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <h3 className="tl-small" style={{ marginBottom: '0.5rem' }}><strong>Active holding thesis &amp; protective exit monitor</strong></h3>
          <div className="tl-ai-feed" data-testid="portfolio-thesis-monitor">
            {holdings.map(h => (
              <article key={h.symbol} className="tl-card tl-card-shell tl-card-shell--compact" data-testid={`holding-intel-${h.symbol}`}>
                <div className="tl-section-head">
                  <div>
                    <strong>{h.symbol}</strong> · <span>{h.name}</span>
                    <span className="tl-small tl-muted"> · {h.sector} · {shares(h.quantity)} sh @ {money(h.averageCost)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <span className="tl-tag">Weight {pct(h.weightPct)}</span>
                    <span className={`tl-tag ${h.thesisHealth?.status === 'action_required' ? 'tl-neg' : h.thesisHealth?.status === 'strengthening' ? 'tl-pos' : ''}`}>
                      {h.thesisHealth?.label}
                    </span>
                  </div>
                </div>
                <p className="tl-small">
                  <strong>Mark:</strong> {money(h.currentPrice)} ({money(h.marketValue)})
                  {' · '}
                  <strong>Unrealized P&amp;L:</strong>{' '}
                  <span className={tone(h.unrealizedPnl)}>{signedMoney(h.unrealizedPnl)} ({signedPct(h.returnPct)})</span>
                  {h.protectiveRules?.stopPrice != null && ` · Stop: ${money(h.protectiveRules.stopPrice)} (−${h.protectiveRules.stopLossPct}%)`}
                  {h.protectiveRules?.takeProfitPrice != null && ` · Target: ${money(h.protectiveRules.takeProfitPrice)} (+${h.protectiveRules.takeProfitPct}%)`}
                </p>
                <p className="tl-small">{h.thesisHealth?.reason}</p>
                {h.entryThesis && <p className="tl-small tl-muted">Entry thesis: {h.entryThesis}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        <h3 className="tl-small" style={{ marginBottom: '0.5rem' }}><strong>Risk-validated paper allocation proposals</strong></h3>
        {allocationProposals.length === 0 ? (
          <p className="tl-small tl-muted" data-testid="portfolio-no-proposals">
            No immediate allocation adjustments indicated under current holdings, cash reserves, and deterministic risk caps.
          </p>
        ) : (
          <div className="tl-ai-feed" data-testid="portfolio-allocation-proposals">
            {allocationProposals.map((prop, idx) => (
              <div key={`${prop.symbol}-${idx}`} className="tl-flow-card" data-testid={`proposal-${prop.symbol}`}>
                <p>
                  <strong className={prop.action === 'BUY' ? 'tl-pos' : 'tl-neg'}>{prop.action}</strong>{' '}
                  <strong>{prop.symbol}</strong> ({prop.sector}) · {shares(prop.quantity)} shares ({money(prop.estimatedNotional)})
                  {' · '}
                  <span className="tl-small tl-muted">
                    Weight {pct(prop.currentWeightPct)} → {pct(prop.targetWeightPct)} · Verified against deterministic caps
                  </span>
                </p>
                <p className="tl-small">{prop.rationale}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
