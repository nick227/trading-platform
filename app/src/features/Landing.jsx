import { useCallback, useEffect } from 'react'
import LazySection from '../components/LazySection'
import Section from '../components/Section'
import { SkeletonRows, TickerRow3 } from './assets/components.jsx'
import { useAlphaDashboard } from '../hooks/useAlphaEngine.js'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap.js'
import { alphaFetch } from '../api/services/alphaEngineService.js'
import pageTitleService from '../services/pageTitleService.js'
import { DEFAULT_MODE, RECOMMENDATION_CAPS } from './assets/constants.js'
import { fmtPct, fmtPrice, fmtScore, fmtAsOf, normalizeConfidence, deriveRowPrice, normalizeSymbol } from './assets/utils.js'
import { CARD_STYLE, SENTIMENT_COLORS, API, GRID_2, GRID_2_ASYM } from './landing/constants.js'
import { useSignals } from './landing/hooks/useSignals.js'
import { usePredictions } from './landing/hooks/usePredictions.js'
import { useCalendarEvents } from './landing/hooks/useCalendarEvents.js'
import { useSpotQuotes } from './landing/hooks/useSpotQuotes.js'
import PerformanceCard from './landing/PerformanceCard.jsx'
import LiveSignalsCard from './landing/LiveSignalsCard.jsx'
import PredictionsPanel from './landing/PredictionsPanel.jsx'
import StrategyPerformanceCard from './landing/StrategyPerformanceCard.jsx'
import TradingCalendarSection from './landing/TradingCalendarSection.jsx'

export default function Landing() {
  useEffect(() => {
    pageTitleService.setHomeTitle('Home Dashboard')
    pageTitleService.setTitle('Home')
  }, [])

  const { data: dashboardData } = useDashboardBootstrap({ refreshInterval: 60000 })
  const { stats: portfolioStats, strategies, loading: portfolioLoading, executions, priceMap } = usePortfolio({ bootstrapData: dashboardData })
  const { error: dashboardError } = useAlphaDashboard({ refreshInterval: 0 })

  const { liveSignals, loading: signalsLoading, error: signalsError }                         = useSignals({ priceMap })
  const { predictionCards, loading: predictionsLoading, error: predictionsError }             = usePredictions()
  const { calendarPredictions }                                                               = useCalendarEvents()
  const { spotQuotes }                                                                        = useSpotQuotes()

  const fetchMarketSection   = useCallback(async () => ({ regime: await alphaFetch(API.REGIME) }), [])
  const fetchRankingsSection = useCallback(() => alphaFetch(API.RANKINGS), [])
  const fetchMoversSection   = useCallback(() => alphaFetch(API.MOVERS), [])
  const fetchRecsSection     = useCallback(async () => {
    const pairs = await Promise.all(
      RECOMMENDATION_CAPS.map((cap) =>
        alphaFetch(API.RECS(cap, DEFAULT_MODE)).then((d) => [cap, d])
      )
    )
    return Object.fromEntries(pairs)
  }, [])

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem 1rem 3rem' }}>

      {/* Row 1: Performance Today + Market Context */}
      <section style={{ ...GRID_2, marginBottom: '1rem' }}>
        <PerformanceCard stats={portfolioStats} loading={portfolioLoading} />

        <Section
          title="Market Context"
          fetcher={fetchMarketSection}
          skeleton={<div className="muted mt-2">Loading…</div>}
          render={(data) => (
            <div className="data-rows mt-2">
              {['SPY', 'QQQ', 'IWM'].map((label) => {
                const q = spotQuotes?.[normalizeSymbol(label)]
                return (
                  <TickerRow3
                    key={label}
                    ticker={label}
                    to={`/orders?ticker=${encodeURIComponent(label)}`}
                    price={fmtPrice(q?._price ?? deriveRowPrice(q))}
                    special={fmtPct(q?.dailyChangePct ?? q?.changePct ?? q?.change)}
                    specialClassName="muted text-right text-nowrap"
                  />
                )
              })}
              <div className="mt-2">
                <div className="eyebrow mb-0">Regime</div>
                <div style={{ fontWeight: 700 }}>
                  {data?.regime?.regime ?? data?.regime?.name ?? data?.regime?.state ?? '—'}
                </div>
              </div>
            </div>
          )}
        />
      </section>

      {/* Alpha Engine error banner */}
      {dashboardError && (
        <section style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: SENTIMENT_COLORS.bearish }} />
            <strong style={{ color: SENTIMENT_COLORS.bearish }}>Alpha Engine Connection Error</strong>
          </div>
          <div style={{ fontSize: 14, color: SENTIMENT_COLORS.bearish, marginTop: '0.5rem' }}>{dashboardError}</div>
        </section>
      )}

      {/* Row 2: Live Signals + Predictions */}
      <section style={{ ...GRID_2_ASYM, marginBottom: '1rem' }}>
        <LiveSignalsCard signals={liveSignals} loading={signalsLoading} error={signalsError} />
        <PredictionsPanel cards={predictionCards} loading={predictionsLoading} error={predictionsError} />
      </section>

      {/* Row 3: Ranked Opportunities + Top Movers */}
      <LazySection
        style={{ ...GRID_2, marginBottom: '1rem' }}
        placeholder={<div style={{ gridColumn: '1 / -1', minHeight: 200 }} />}
      >
        <Section
          title="Ranked Opportunities"
          fetcher={fetchRankingsSection}
          skeleton={<div className="mt-2"><SkeletonRows count={8} /></div>}
          emptyMessage="No ranked opportunities."
          render={(data) => {
            const rows = data?.rankings || []
            return rows.length === 0 ? null : (
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {rows.slice(0, 12).map((r) => {
                  const tkr  = r.ticker ?? r.symbol
                  const score = Number(r.score)
                  const conf  = Number(r.conviction ?? r.confidence)
                  return (
                    <TickerRow3
                      key={`edge-${tkr}`}
                      ticker={tkr}
                      to={`/orders?ticker=${encodeURIComponent(tkr)}`}
                      price={fmtPrice(r._price ?? deriveRowPrice(r))}
                      special={`Score ${fmtScore(score)} · Conf ${fmtPct(conf)} · ${fmtPct(r.dailyChangePct)}`}
                      specialClassName="muted text-right text-nowrap"
                    />
                  )
                })}
              </div>
            )
          }}
        />

        <Section
          title="Top Movers"
          fetcher={fetchMoversSection}
          skeleton={<div className="mt-2"><SkeletonRows count={6} /></div>}
          emptyMessage="No movers data available."
          render={(data) => {
            const rows = data?.rankings || []
            return rows.length === 0 ? null : (
              <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {rows.slice(0, 8).map((r, idx) => {
                  const tkr        = r.ticker ?? r.symbol
                  const currentRank = r.currentRank ?? r.current_rank ?? r.rank ?? null
                  const priorRank   = r.priorRank ?? r.prior_rank ?? r.prevRank ?? r.previousRank ?? r.previous_rank ?? null
                  const rankChange  = r.rankChange ?? r.rank_change ?? (currentRank !== null && priorRank !== null ? priorRank - currentRank : null)
                  const rankLabel   = currentRank !== null
                    ? `#${currentRank}${typeof rankChange === 'number' ? ` · ${rankChange > 0 ? '+' : ''}${rankChange}` : ''}`
                    : '—'
                  return (
                    <TickerRow3
                      key={`mover-${tkr}-${idx}`}
                      ticker={tkr}
                      to={`/orders?ticker=${encodeURIComponent(tkr)}`}
                      price={fmtPrice(r._price ?? deriveRowPrice(r))}
                      special={`${rankLabel} · ${fmtPct(r.dailyChangePct ?? r.changePct ?? r.change)}`}
                      specialClassName="muted text-right text-nowrap"
                    />
                  )
                })}
              </div>
            )
          }}
        />
      </LazySection>

      {/* Row 4: Price-Capped Recommendations */}
      <LazySection placeholder={<div style={{ minHeight: 200 }} />}>
        <Section
          title="Price-Capped Recommendations"
          right={`Mode: ${DEFAULT_MODE}`}
          fetcher={fetchRecsSection}
          skeleton={<div className="card card-pad-sm"><SkeletonRows count={8} /></div>}
          render={(data) => (
            <div className="l-grid-3">
              {RECOMMENDATION_CAPS.map((cap) => {
                const payload = data?.[cap]
                const rows    = payload?.recommendations ?? payload?.items ?? []
                const asOf    = fmtAsOf(payload?.asOf ?? payload?.as_of ?? rows?.[0]?.asOf ?? rows?.[0]?.as_of)
                return (
                  <article key={cap} className="card card-pad-sm">
                    <div className="l-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <strong>Under ${cap}</strong>
                      <span className="muted" style={{ fontSize: 12 }}>{asOf ? `As of ${asOf}` : ' '}</span>
                    </div>
                    {Array.isArray(rows) && rows.length > 0 ? (
                      <div className="data-rows mt-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                        {rows.slice(0, 10).map((r) => {
                          const tkr   = r.ticker ?? r.symbol
                          const conf  = normalizeConfidence(r.confidence)
                          const entry = Array.isArray(r.entryZone) ? `${r.entryZone[0]} – ${r.entryZone[1]}` : r.entryZone
                          return (
                            <TickerRow3
                              key={`action-${tkr}`}
                              ticker={tkr}
                              to={`/orders?ticker=${encodeURIComponent(tkr)}`}
                              price={fmtPrice(r._price ?? deriveRowPrice(r))}
                              special={`${r.action ?? '—'}${conf !== null ? ` · ${conf}%` : ''}${entry ? ` · Entry ${entry}` : ''}`}
                              specialClassName="muted text-right text-ellipsis-one-line"
                            />
                          )
                        })}
                      </div>
                    ) : (
                      <div className="muted mt-2">No recommendations.</div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        />
      </LazySection>

      {/* Row 5: Strategy Performance */}
      <LazySection style={{ marginTop: '1rem', marginBottom: '1rem' }} placeholder={<div style={{ minHeight: 160 }} />}>
        <StrategyPerformanceCard executions={executions} strategies={strategies} />
      </LazySection>

      {/* Row 6: Trading Calendar */}
      <LazySection style={{ ...CARD_STYLE, padding: '2rem', marginBottom: '1rem' }} placeholder={<div style={{ minHeight: 300 }} />}>
        <TradingCalendarSection predictions={calendarPredictions} />
      </LazySection>

    </div>
  )
}
