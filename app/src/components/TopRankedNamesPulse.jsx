import { Fragment, memo, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function formatListItem(item) {
  if (item == null) return null
  if (typeof item === 'string') return item.trim() || null
  if (typeof item === 'object') {
    const label = String(item.label ?? item.name ?? item.title ?? item.key ?? '').trim()
    const detail = String(item.detail ?? item.message ?? item.value ?? item.reason ?? '').trim()
    if (label && detail) return `${label}: ${detail}`
    if (label) return label
    if (detail) return detail
  }
  return null
}

function coerceFiniteNumber(value) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function coerceConfidencePercent(value) {
  const num = coerceFiniteNumber(value)
  if (num === null) return null
  if (num > 1 && num <= 100) return num
  if (num >= 0 && num <= 1) return num * 100
  return null
}

function normalizeDirection(value) {
  if (value == null) return null
  const raw = String(value).trim().toUpperCase()
  if (!raw) return null

  if (raw === 'BUY' || raw === 'BULLISH' || raw === 'UP' || raw === 'LONG' || raw === '1') return 'BUY'
  if (raw === 'SELL' || raw === 'BEARISH' || raw === 'DOWN' || raw === 'SHORT' || raw === '-1') return 'SELL'
  if (raw === 'HOLD' || raw === 'NEUTRAL' || raw === 'WATCH' || raw === 'FLAT' || raw === '0') return 'HOLD'

  if (raw.includes('BUY') || raw.includes('BULL')) return 'BUY'
  if (raw.includes('SELL') || raw.includes('BEAR') || raw.includes('SHORT')) return 'SELL'
  if (raw.includes('HOLD') || raw.includes('NEUTRAL') || raw.includes('WATCH') || raw.includes('FLAT')) return 'HOLD'

  return null
}

function extractScore(row) {
  const raw = row && typeof row === 'object' ? row : {}
  return coerceFiniteNumber(
    raw.score ??
      raw.edgeScore ??
      raw.score_today ??
      raw.multiplier_score ??
      raw.rankScore ??
      raw.rank_score
  )
}

function extractDirection(row, score) {
  const raw = row && typeof row === 'object' ? row : {}
  const fromPayload = normalizeDirection(
    raw.direction ??
      raw.action ??
      raw.verdict ??
      raw.prediction ??
      raw.rankContext?.direction ??
      raw.rankContext?.status ??
      raw.rankContext?.signal ??
      raw.rankContext?.bias
  )

  if (fromPayload) return fromPayload
  if (typeof score === 'number') return score > 0 ? 'BUY' : score < 0 ? 'SELL' : 'HOLD'
  return 'HOLD'
}

function fmtUsd(value) {
  const num = coerceFiniteNumber(value)
  if (num === null) return '--'
  return usdFormatter.format(num)
}

function extractConfidencePercent(row) {
  const raw = row && typeof row === 'object' ? row : {}
  const value =
    raw.confidence ??
    raw.modelConfidence ??
    raw.conviction ??
    raw.attributionConfidence ??
    raw.attribution?.confidence ??
    raw.rankContext?.confidence ??
    null

  const pct = coerceConfidencePercent(value)
  if (pct === null) return null
  return Math.max(0, Math.min(100, Math.round(pct)))
}

function deriveTrustworthiness(row, score) {
  const extracted = extractConfidencePercent(row)
  if (typeof extracted === 'number') return extracted

  if (typeof score === 'number') {
    const base = score === 0 ? 55 : 62
    const boost = Math.min(25, Math.round(Math.abs(score) * 12))
    return Math.max(45, Math.min(90, base + boost))
  }

  return 60
}

function trustTier(pct) {
  if (typeof pct !== 'number') return '—'
  if (pct >= 80) return 'High'
  if (pct >= 65) return 'Medium'
  return 'Low'
}

function rankStatus(rawStatus) {
  const v = String(rawStatus ?? '').trim().toLowerCase()
  if (!v) return null
  if (v.includes('rise') || v.includes('up') || v.includes('improv') || v.includes('breakout')) return 'rising'
  if (v.includes('fall') || v.includes('down') || v.includes('slip') || v.includes('weak')) return 'falling'
  if (v.includes('stable') || v.includes('flat') || v.includes('range')) return 'stable'
  return v
}

function fragilityToRiskLevel(row) {
  const raw = row && typeof row === 'object' ? row : {}
  const fRaw = raw.fragilityScore ?? raw.fragility_score ?? raw.fragility ?? raw.fragilityPct ?? null
  const fNum = coerceFiniteNumber(fRaw)
  let f = fNum
  if (typeof fNum === 'number' && fNum > 1 && fNum <= 100) f = fNum / 100
  if (typeof f === 'number') f = Math.max(0, Math.min(1, f))

  if (typeof f !== 'number') {
    const risks = Array.isArray(raw.rankContext?.risks) ? raw.rankContext.risks : []
    const fragLine = risks.map((x) => String(x ?? '')).find((txt) => /fragility/i.test(txt)) ?? null
    if (fragLine) {
      const match = fragLine.match(/(-?\d+(\.\d+)?)/)
      const parsed = match ? Number(match[1]) : NaN
      if (Number.isFinite(parsed)) {
        f = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed
        if (typeof f === 'number') f = Math.max(0, Math.min(1, f))
      }
    }
  }

  const riskHints =
    (Array.isArray(raw.risks) ? raw.risks.length : 0) +
    (Array.isArray(raw.rankContext?.risks) ? raw.rankContext.risks.length : 0)

  if (typeof f === 'number') {
    if (f >= 0.7) return 'High'
    if (f >= 0.45) return 'Medium'
    return 'Low'
  }

  if (riskHints >= 4) return 'High'
  if (riskHints >= 2) return 'Medium'
  return 'Low'
}

function trendStatus(row) {
  const raw = row && typeof row === 'object' ? row : {}
  const status = rankStatus(raw.rankContext?.status)
  if (status === 'rising') return 'Improving'
  if (status === 'falling') return 'Slipping'

  const dcp = coerceFiniteNumber(raw.dailyChangePct ?? raw.daily_change_pct ?? raw.changePct ?? raw.change_pct)
  if (typeof dcp === 'number') {
    if (dcp >= 1.25) return 'Rising'
    if (dcp <= -1.25) return 'Falling'
    if (Math.abs(dcp) >= 0.5) return 'Moving'
    return 'Stable'
  }

  const rankChange = coerceFiniteNumber(raw.rankChange ?? raw.rank_change ?? raw.rankDelta ?? raw.rank_delta)
  if (typeof rankChange === 'number') {
    if (rankChange >= 3) return 'Improving'
    if (rankChange <= -3) return 'Slipping'
  }

  return 'Stable'
}

function timingLabel(direction, trustPct, risk, trend) {
  const dir = normalizeDirection(direction) ?? 'HOLD'
  const trust = typeof trustPct === 'number' ? trustPct : 60

  if (dir === 'SELL' && trust >= 65) return 'Avoid'

  // Only say "Buy Now" when we have a clear near-term push.
  // Otherwise, default to "Wait" to avoid over-claiming urgency.
  const hasEntryPush = trend === 'Rising' || trend === 'Improving' || trend === 'Moving'
  if (dir === 'BUY' && trust >= 75 && risk !== 'High' && trend !== 'Falling' && hasEntryPush) return 'Buy Now'

  return 'Wait'
}

function bestFor(risk, trend, horizon) {
  const hz = String(horizon ?? '').trim().toLowerCase()
  if (hz.includes('long')) return 'Long-term conservative'
  if (hz.includes('swing')) return 'Swing traders'
  if (hz.includes('day') || hz.includes('intraday')) return 'Active traders'

  if (risk === 'Low' && trend === 'Stable') return 'Long-term conservative'
  if (risk === 'High') return 'Tactical / aggressive'
  if (trend === 'Rising') return 'Momentum + swing'
  return 'Balanced investors'
}

function expectedBehavior(risk, trend) {
  if (risk === 'Low' && trend === 'Stable') return 'Slow steady mover'
  if (trend === 'Rising' && risk !== 'High') return 'Steady upside pressure'
  if (trend === 'Rising' && risk === 'High') return 'Fast mover, higher swings'
  if (trend === 'Falling') return 'Choppy / under pressure'
  return 'Range-bound / mixed'
}

function whatCouldChangeIt(risk, trend) {
  if (risk === 'High') return 'Setup breaks / whipsaw'
  if (trend === 'Slipping' || trend === 'Falling') return 'Rank slippage / weaker tape'
  return 'Stronger competitors / weaker signals'
}

function invalidatorLine(row) {
  const raw = row && typeof row === 'object' ? row : {}
  const invalidators = Array.isArray(raw.rankContext?.invalidators)
    ? raw.rankContext.invalidators.map(formatListItem).filter(Boolean)
    : []
  return invalidators[0] ?? null
}

function bottomLine({ timing, risk, trustPct, direction }) {
  const trust = typeof trustPct === 'number' ? trustTier(trustPct).toLowerCase() : 'medium'
  const dir = normalizeDirection(direction) ?? 'HOLD'

  if (timing === 'Buy Now' && risk === 'Low') return 'Strong pick right now'
  if (timing === 'Buy Now' && risk !== 'Low') return 'Good edge, size carefully'
  if (timing === 'Avoid') return 'Not favored right now'
  if (dir === 'BUY' && trust === 'high') return 'Strong stock, weak timing'
  if (risk === 'Low') return 'Solid, not urgent'
  return 'Decent, watch conditions'
}

function whyLine(row, { direction, timing, risk, trustPct }) {
  const raw = row && typeof row === 'object' ? row : {}
  const reasons = Array.isArray(raw.reasons) ? raw.reasons.map(formatListItem).filter(Boolean) : []
  const drivers = Array.isArray(raw.drivers) ? raw.drivers.map(formatListItem).filter(Boolean) : []
  const changes = Array.isArray(raw.changes) ? raw.changes.map(formatListItem).filter(Boolean) : []
  const basis = Array.isArray(raw.rankContext?.basis) ? raw.rankContext.basis.map(formatListItem).filter(Boolean) : []
  const rcTiming = Array.isArray(raw.rankContext?.timing) ? raw.rankContext.timing.map(formatListItem).filter(Boolean) : []
  const rcRisks = Array.isArray(raw.rankContext?.risks) ? raw.rankContext.risks.map(formatListItem).filter(Boolean) : []

  const firstText =
    basis[0] ??
    rcTiming[0] ??
    reasons[0] ??
    drivers[0] ??
    changes[0] ??
    rcRisks[0] ??
    null

  if (firstText) return firstText

  const trust = typeof trustPct === 'number' ? trustTier(trustPct) : 'Medium'
  const dir = normalizeDirection(direction) ?? 'HOLD'

  if (dir === 'BUY' && timing === 'Buy Now' && trust === 'High') return 'Most reliable pick in group right now.'
  if (dir === 'BUY' && timing === 'Wait') return 'Strong name, timing not urgent yet.'
  if (dir === 'SELL') return 'Signals not supportive versus peers right now.'
  if (risk === 'Low') return 'Stable setup, low relative risk.'
  return 'Mixed signals; monitor for change.'
}

export default memo(function TopRankedNamesPulse({ topRankings, loading }) {
  const navigate = useNavigate()
  const [expandedTicker, setExpandedTicker] = useState(null)

  const { rows, coverage } = useMemo(() => {
    const rankings = Array.isArray(topRankings?.rankings) ? topRankings.rankings : []

    const out = rankings
      .slice(0, 8)
      .map((r) => {
        const ticker = String(r?.symbol ?? r?.ticker ?? r?.tkr ?? '').toUpperCase().trim()
        if (!ticker) return null

        const price = coerceFiniteNumber(r?.price ?? r?.last ?? r?.quote?.price ?? r?.quote?.last) ?? null
        const score = extractScore(r)
        const direction = extractDirection(r, score)
        const trustPct = deriveTrustworthiness(r, score)
        const trend = trendStatus(r)
        const risk = fragilityToRiskLevel(r)
        const timing = timingLabel(direction, trustPct, risk, trend)
        const horizon = r?.rankContext?.horizon ?? null
        const invalidator = invalidatorLine(r)

        return {
          ticker,
          price,
          direction,
          trustPct,
          trend,
          risk,
          timing,
          why: whyLine(r, { direction, timing, risk, trustPct }),
          bestFor: bestFor(risk, trend, horizon),
          expectedBehavior: expectedBehavior(risk, trend),
          whatCouldChangeIt: invalidator ?? whatCouldChangeIt(risk, trend),
          bottomLine: bottomLine({ timing, risk, trustPct, direction }),
        }
      })
      .filter(Boolean)

    const cov = {
      total: out.length,
      confidence: 0,
      direction: 0,
      score: 0,
      dailyChangePct: 0,
      fragility: 0,
      reasons: 0,
      rcBasis: 0,
      rcTiming: 0,
      rcInvalidators: 0,
      rcStatus: 0,
    }

    for (const r of rankings.slice(0, 8)) {
      if (extractConfidencePercent(r) != null) cov.confidence += 1
      if (normalizeDirection(r?.direction ?? r?.action ?? r?.verdict ?? r?.prediction ?? r?.rankContext?.direction ?? r?.rankContext?.status) != null) {
        cov.direction += 1
      }
      if (extractScore(r) != null) cov.score += 1
      if (coerceFiniteNumber(r?.dailyChangePct ?? r?.daily_change_pct ?? r?.changePct ?? r?.change_pct) != null) cov.dailyChangePct += 1
      if (coerceFiniteNumber(r?.fragilityScore ?? r?.fragility_score ?? r?.fragility ?? r?.fragilityPct) != null) cov.fragility += 1
      if ((Array.isArray(r?.reasons) && r.reasons.length) || (Array.isArray(r?.drivers) && r.drivers.length) || (Array.isArray(r?.changes) && r.changes.length)) {
        cov.reasons += 1
      }
      if (Array.isArray(r?.rankContext?.basis) && r.rankContext.basis.length) cov.rcBasis += 1
      if (Array.isArray(r?.rankContext?.timing) && r.rankContext.timing.length) cov.rcTiming += 1
      if (Array.isArray(r?.rankContext?.invalidators) && r.rankContext.invalidators.length) cov.rcInvalidators += 1
      if (r?.rankContext?.status != null && String(r.rankContext.status).trim()) cov.rcStatus += 1
    }

    return { rows: out, coverage: cov }
  }, [topRankings])

  return (
    <div className="top-ranked-names-pulse">
      <div className="eyebrow" style={{ color: '#d9d9d9' }}>
        Top ranked names <span style={{ opacity: 0.7 }}>- Ordered by engine rank</span>
      </div>
      {!loading && rows.length > 0 ? (
        <div className="trnp-state" style={{ marginTop: 10 }}>
          Inputs: trust {coverage.confidence}/{coverage.total} • basis {coverage.rcBasis}/{coverage.total} • timing {coverage.rcTiming}/{coverage.total} • invalidators {coverage.rcInvalidators}/{coverage.total} • status {coverage.rcStatus}/{coverage.total}
        </div>
      ) : null}

      {loading ? (
        <div className="trnp-state">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="trnp-state">--</div>
      ) : (
        <div className="trnp-tableWrap">
          <table className="trnp-table">
            <thead>
              <tr>
                <th className="trnp-th trnp-th-rank">#</th>
                <th className="trnp-th">Ticker</th>
                <th className="trnp-th trnp-th-num">Price</th>
                <th className="trnp-th">Trust</th>
                <th className="trnp-th">Buy Now or Wait</th>
                <th className="trnp-th">Trend</th>
                <th className="trnp-th">Risk</th>
                <th className="trnp-th">Bottom line</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const expanded = expandedTicker === row.ticker
                return (
                  <Fragment key={row.ticker}>
                    <tr
                      className={`trnp-tr ${expanded ? 'trnp-tr--expanded' : ''}`.trim()}
                      onClick={() => navigate(`/orders?ticker=${encodeURIComponent(row.ticker)}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/orders?ticker=${encodeURIComponent(row.ticker)}`)
                        }
                      }}
                      title={`Open details for ${row.ticker}`}
                    >
                      <td className="trnp-td trnp-td-rank">{idx + 1}</td>
                      <td className="trnp-td">
                        <div className="trnp-tickerCell">
                          <Link
                            className="trnp-tickerLink"
                            to={`/orders?ticker=${encodeURIComponent(row.ticker)}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.ticker}
                          </Link>
                          <button
                            type="button"
                            className="trnp-expand"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedTicker((prev) => (prev === row.ticker ? null : row.ticker))
                            }}
                            aria-label={expanded ? `Collapse ${row.ticker}` : `Expand ${row.ticker}`}
                            title={expanded ? 'Collapse' : 'Expand'}
                          >
                            {expanded ? '▾' : '▸'}
                          </button>
                        </div>
                        <div className="trnp-why">{row.why}</div>
                      </td>
                      <td className="trnp-td trnp-td-num">{fmtUsd(row.price)}</td>
                      <td className="trnp-td">
                        <div className="trnp-pill">
                          {trustTier(row.trustPct)}
                          <span className="trnp-pillSub">{typeof row.trustPct === 'number' ? ` ${row.trustPct}%` : ''}</span>
                        </div>
                      </td>
                      <td className="trnp-td">{row.timing}</td>
                      <td className="trnp-td">{row.trend}</td>
                      <td className="trnp-td">{row.risk}</td>
                      <td className="trnp-td">{row.bottomLine}</td>
                    </tr>

                    {expanded ? (
                      <tr className="trnp-detailTr">
                        <td className="trnp-detailTd" colSpan={8} onClick={(e) => e.stopPropagation()}>
                          <div className="trnp-detailGrid">
                            <div className="trnp-detailItem">
                              <div className="trnp-detailLabel">Best For</div>
                              <div className="trnp-detailValue">{row.bestFor}</div>
                            </div>
                            <div className="trnp-detailItem">
                              <div className="trnp-detailLabel">Expected Behavior</div>
                              <div className="trnp-detailValue">{row.expectedBehavior}</div>
                            </div>
                            <div className="trnp-detailItem">
                              <div className="trnp-detailLabel">What Could Change It</div>
                              <div className="trnp-detailValue">{row.whatCouldChangeIt}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
})
