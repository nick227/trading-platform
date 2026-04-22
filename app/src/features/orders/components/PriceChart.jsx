import { useEffect, useMemo, useRef, useState } from 'react'

const RANGES = ['1D', '1W', '1M', '3M', '1Y', '5Y', 'MAX']
const EMPTY_ARR = []
const COMPACT_BAR_COUNT = 40
const COVERAGE_THRESHOLD = 0.6
const TOOLTIP_WIDTH = 220
const TOOLTIP_HEIGHT = 74
const TOOLTIP_EDGE_PAD = 8
const TOOLTIP_OFFSET = 12
const PLOT_INSET_COMPACT = { top: 0, right: 0, bottom: 0, left: 0 }
// Vertical-only padding: reserve space for top/bottom labels without shrinking width.
const PLOT_INSET_FULL = { top: 28, right: 0, bottom: 18, left: 0 }
const PRICE_LINE_STROKE_WIDTH = 1.2
const EXPECTED_DAYS = {
  '1D': 1.2,
  '1W': 7.5,
  '1M': 31,
  '3M': 93,
  '1Y': 370,
  '5Y': 1826,
  'MAX': Infinity,
}
const FALLBACK_DAILY_POINTS = {
  '1D': 2,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '1Y': 252,
  '5Y': 1260,
  'MAX': Infinity,
}

function formatQuoteFreshness(selectedStock) {
  if (!selectedStock?.freshness) return null

  const freshnessLabel = selectedStock.freshness === 'live'
    ? 'Live'
    : selectedStock.freshness === 'fresh'
      ? 'Fresh'
      : selectedStock.freshness === 'stale'
        ? 'Stale'
        : 'Delayed'

  const seconds = Number.isFinite(selectedStock.ageMs)
    ? Math.max(0, Math.round(selectedStock.ageMs / 1000))
    : null
  if (seconds == null) return freshnessLabel
  return `${freshnessLabel} • Updated ${seconds}s ago`
}

function clampPct(pct) {
  return Math.max(0, Math.min(100, pct))
}

function formatCompactNumber(value, fractionDigits = 2) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toFixed(fractionDigits)
}

function buildLinePath(series, yFromValue) {
  if (!series?.length) return null
  const n = series.length
  if (n < 2) return null

  let d = ''
  let started = false
  for (let i = 0; i < n; i++) {
    const v = series[i]
    if (!Number.isFinite(v)) {
      started = false
      continue
    }

    const x = (i / (n - 1)) * 100
    const y = yFromValue(v)
    d += `${started ? ' L' : ' M'} ${x.toFixed(2)} ${y.toFixed(2)}`
    started = true
  }

  return d || null
}

function formatChartDate(ts, dateStr, range, hasIntraday) {
  if (Number.isFinite(ts)) {
    const iso = new Date(ts).toISOString()

    if (range === '1D') {
      return hasIntraday ? iso.slice(11, 16) : iso.slice(0, 10)
    }

    if (range === '1W') {
      return hasIntraday ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : iso.slice(5, 10)
    }

    return iso.slice(0, 10) // YYYY-MM-DD
  }

  if (!dateStr) return '—'
  return dateStr
}

function getTooltipPosition(hover) {
  const left = Math.max(
    TOOLTIP_EDGE_PAD,
    Math.min(
      (hover?.x ?? 0) + TOOLTIP_OFFSET,
      (hover?.w ?? 0) - TOOLTIP_WIDTH - TOOLTIP_EDGE_PAD
    )
  )
  const top = Math.max(
    TOOLTIP_EDGE_PAD,
    Math.min(
      (hover?.y ?? 0) - TOOLTIP_HEIGHT - TOOLTIP_OFFSET,
      (hover?.h ?? 0) - TOOLTIP_HEIGHT - TOOLTIP_EDGE_PAD
    )
  )

  return { left, top }
}

/**
 * PriceChart — unified price/volume bar chart.
 *
 * compact=true  (left column)  : 180 px height, 40 bars, no volume row.
 * compact=false (middle column): flex height (min 300 px), 100 bars, 50 volume bars.
 */
export default function PriceChart({
  selectedStock,
  priceHistory,
  priceRange,
  chartRange,
  onRangeChange,
  loading,
  compact = false,
  nextOpen,
}) {
  const pricePanelRef = useRef(null)
  const plotRef = useRef(null)

  const [hover, setHover] = useState(null) // { index, x, y }
  const hoverRafRef = useRef(0)
  const pendingHoverRef = useRef(null)
  const canRaf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'

  useEffect(() => {
    return () => {
      if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current)
    }
  }, [])

  const safePriceHistory = Array.isArray(priceHistory) ? priceHistory : EMPTY_ARR

  // Memoised slices — avoids re-allocating arrays on every render.
  const rangeDays = EXPECTED_DAYS[chartRange] ?? Infinity
  const chartBars = useMemo(() => {
    if (!safePriceHistory.length) return EMPTY_ARR
    if (!Number.isFinite(rangeDays) || rangeDays === Infinity) {
      return compact ? safePriceHistory.slice(-COMPACT_BAR_COUNT) : safePriceHistory
    }

    const end = safePriceHistory[safePriceHistory.length - 1]
    const endTs = end?.ts
    if (Number.isFinite(endTs)) {
      const startTs = endTs - rangeDays * 24 * 60 * 60 * 1000
      const sliced = safePriceHistory.filter(p => (Number.isFinite(p?.ts) ? p.ts >= startTs : true))
      const ranged = sliced.length ? sliced : safePriceHistory
      return compact ? ranged.slice(-COMPACT_BAR_COUNT) : ranged
    }

    // Fallback: assume daily bars
    const n = FALLBACK_DAILY_POINTS[chartRange] ?? 100
    if (!Number.isFinite(n) || n === Infinity) {
      return compact ? safePriceHistory.slice(-COMPACT_BAR_COUNT) : safePriceHistory
    }
    const ranged = safePriceHistory.slice(-Math.min(safePriceHistory.length, n))
    return compact ? ranged.slice(-COMPACT_BAR_COUNT) : ranged
  }, [safePriceHistory, chartRange, rangeDays, compact])
  const closeSeries = useMemo(
    () => chartBars.map(p => (p.close ?? p.price ?? 0)),
    [chartBars]
  )
  const hasIntraday = useMemo(() => {
    for (const p of chartBars) {
      if (!Number.isFinite(p?.ts)) continue
      const dt = new Date(p.ts)
      if (dt.getUTCHours() !== 0 || dt.getUTCMinutes() !== 0) return true
    }
    return false
  }, [chartBars])

  const yMin = priceRange?.min ?? 0
  const yMax = Number.isFinite(priceRange?.max) ? priceRange.max : yMin + (priceRange?.range ?? 0)
  const yMid = (yMin + yMax) / 2
  const safeRange = priceRange?.range > 0 ? priceRange?.range : 1

  const priceLinePath = useMemo(() => {
    if (!(priceRange?.range > 0)) return null
    return buildLinePath(closeSeries, (v) => 100 - clampPct(((v - yMin) / safeRange) * 100))
  }, [closeSeries, priceRange?.range, safeRange, yMin])

  if (!selectedStock) {
    return (
      <article className={`card ${compact ? 'card-pad-sm' : 'card-pad-md'}`}>
        <div className="panel-empty">
          <div className={`${compact ? 'text-sm' : 'text-md'} font-600 mb-2`}>
            Select a stock to view chart
          </div>
          {!compact && <div className="text-sm muted">Choose from the search dropdown above</div>}
        </div>
      </article>
    )
  }

  const firstBar = chartBars.length > 0 ? chartBars[0] : null
  const lastBar = chartBars.length > 0 ? chartBars[chartBars.length - 1] : null
  const startDateLabel = formatChartDate(firstBar?.ts, firstBar?.date, chartRange, hasIntraday)
  const endDateLabel = formatChartDate(lastBar?.ts, lastBar?.date, chartRange, hasIntraday)

  const startTs = firstBar?.ts
  const endTs = lastBar?.ts
  const spanDays = (Number.isFinite(startTs) && Number.isFinite(endTs))
    ? (endTs - startTs) / (1000 * 60 * 60 * 24)
    : null
  const expectedDays = EXPECTED_DAYS[chartRange] ?? null
  const limitedForRange = Boolean(
    expectedDays &&
    expectedDays !== Infinity &&
    spanDays != null &&
    spanDays < expectedDays * COVERAGE_THRESHOLD
  )

  const currentPrice = selectedStock.price ?? 0
  const freshnessText = formatQuoteFreshness(selectedStock)
  const lastCandle = safePriceHistory.length > 0 ? safePriceHistory[safePriceHistory.length - 1] : null
  const lastO = lastCandle?.open ?? lastCandle?.price ?? currentPrice
  const lastH = lastCandle?.high ?? lastCandle?.price ?? currentPrice
  const lastL = lastCandle?.low ?? lastCandle?.price ?? currentPrice
  const lastC = lastCandle?.close ?? lastCandle?.price ?? currentPrice
  const hasDistinctOHLC = [lastO, lastH, lastL, lastC].every(Number.isFinite)
    ? !(lastO === lastH && lastH === lastL && lastL === lastC)
    : false
  const prevCandle = safePriceHistory.length > 1 ? safePriceHistory[safePriceHistory.length - 2] : null
  const prevClose = prevCandle ? (prevCandle.close ?? prevCandle.price ?? lastC) : lastC
  const lastPriceUp = currentPrice >= prevClose
  const lastPriceColor = lastPriceUp ? '#0a7a47' : '#c0392b'
  const currentPricePct = clampPct(((currentPrice - yMin) / safeRange) * 100)

  const hoveredPoint = (!compact && hover && chartBars[hover.index]) ? chartBars[hover.index] : null
  const hoverClose = hoveredPoint ? (hoveredPoint.close ?? hoveredPoint.price ?? 0) : null
  const hoverPricePct = (hoverClose != null && priceRange?.range > 0)
    ? clampPct(((hoverClose - yMin) / safeRange) * 100)
    : null

  const plotInset = compact ? PLOT_INSET_COMPACT : PLOT_INSET_FULL

  const scheduleHoverUpdate = (nextHover) => {
    if (!canRaf) {
      setHover(nextHover)
      return
    }

    pendingHoverRef.current = nextHover
    if (hoverRafRef.current) return

    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = 0
      const pending = pendingHoverRef.current
      pendingHoverRef.current = null
      setHover(prev => {
        if (!pending) return null
        if (prev && prev.index === pending.index && prev.x === pending.x && prev.y === pending.y) return prev
        return pending
      })
    })
  }

  const clearHover = () => {
    pendingHoverRef.current = null
    if (hoverRafRef.current) {
      cancelAnimationFrame(hoverRafRef.current)
      hoverRafRef.current = 0
    }
    setHover(null)
  }

  return (
    <article className="card card-pad-sm">
      {/* Header */}
      <div className="l-row mb-3">
        <div className="hstack">
          <select
            aria-label="Chart range"
            value={chartRange}
            onChange={(e) => onRangeChange(e.target.value)}
            className="select-xs"
          >
            {RANGES.map(range => (
              <option key={range} value={range}>{range}</option>
            ))}
          </select>
          {!compact && limitedForRange && (
            <span className="badge badge-warning badge-xs">Limited data</span>
          )}
          {loading && <span className="text-xs muted">Loading…</span>}
        </div>
      </div>

      {/* Chart area */}
      <div className={`chart-shell ${compact ? 'chart-shell-compact' : 'chart-shell-full'}`}>
        {loading ? (
          <div className="panel-empty">Loading chart data…</div>
        ) : chartBars.length > 0 ? (
          <>
            {/* Price */}
            <div
              ref={pricePanelRef}
              className="chart-panel"
              style={{
                '--plot-top': `${plotInset.top}px`,
                '--plot-right': `${plotInset.right}px`,
                '--plot-bottom': `${plotInset.bottom}px`,
                '--plot-left': `${plotInset.left}px`,
              }}
            >
              {/* Start/End dates */}
              {!compact && (
                <>
                  <div className="chart-tag chart-tag-left">
                    {startDateLabel}
                  </div>
                  <div className="chart-tag chart-tag-right">
                    {endDateLabel}
                  </div>
                </>
              )}

              {/* Y axis labels (minimal) */}
              {!compact && priceRange?.range > 0 && (
                <>
                  <div className="chart-axis-label chart-axis-top">
                    ${formatCompactNumber(yMax, 2)}
                  </div>
                  <div className="chart-axis-label chart-axis-mid">
                    ${formatCompactNumber(yMid, 2)}
                  </div>
                  <div className="chart-axis-label chart-axis-bot">
                    ${formatCompactNumber(yMin, 2)}
                  </div>
                </>
              )}

              {/* Last-price pill */}
              {!compact && priceRange?.range > 0 && (
                <div
                  className="chart-price-pill"
                  style={{ '--pill-bg': lastPriceColor, '--pill-bottom': `${currentPricePct}%` }}
                >
                  {formatCompactNumber(currentPrice, 2)}
                </div>
              )}

              {/* Hover crosshair + tooltip */}
              {!compact && hover && (
                <div className="chart-crosshair-layer">
                  <div className="chart-crosshair-v" style={{ left: hover.x }} />
                  {hoverPricePct != null && (
                    <div className="chart-crosshair-h" style={{ bottom: `${hoverPricePct}%` }} />
                  )}

                  {hoveredPoint && (
                    <div className="chart-tooltip" style={getTooltipPosition(hover)}>
                      <div className="text-xs font-700 mb-2">{hoveredPoint.date ?? '—'}</div>
                      <div className="l-row text-xs">
                        <div className="font-600">Close</div>
                        <div className="font-700">${formatCompactNumber(hoveredPoint.close ?? hoveredPoint.price, 2)}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div
                ref={plotRef}
                onMouseMove={(e) => {
                  if (compact) return
                  if (!pricePanelRef.current || !plotRef.current || chartBars.length === 0) return

                  const panelRect = pricePanelRef.current.getBoundingClientRect()
                  const plotRect = plotRef.current.getBoundingClientRect()
                  if (plotRect.width <= 0) return

                  const xInPlot = e.clientX - plotRect.left
                  const idx = Math.max(0, Math.min(chartBars.length - 1, Math.round((xInPlot / plotRect.width) * (chartBars.length - 1))))
                  const xCenterInPanel = (plotRect.left - panelRect.left) + (idx / Math.max(1, chartBars.length - 1)) * plotRect.width
                  const yInPanel = e.clientY - panelRect.top

                  scheduleHoverUpdate({ index: idx, x: xCenterInPanel, y: yInPanel, w: panelRect.width, h: panelRect.height })
                }}
                onMouseLeave={clearHover}
                className={`chart-plot ${compact ? 'chart-plot-compact' : ''}`}
              >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart-svg">
                  {priceLinePath && (
                    <>
                      <path d={priceLinePath} fill="none" stroke="var(--color-positive)" strokeWidth={PRICE_LINE_STROKE_WIDTH} strokeLinejoin="round" strokeLinecap="round" />
                      <path d={`${priceLinePath} L 100 100 L 0 100 Z`} fill="rgba(31, 138, 76, 0.10)" stroke="none" />
                    </>
                  )}

                  {/* Hover dot */}
                  {!compact && hover && hoverClose != null && priceRange?.range > 0 && chartBars.length > 1 && (
                    <circle
                      cx={(hover.index / (chartBars.length - 1)) * 100}
                      cy={100 - clampPct(((hoverClose - yMin) / safeRange) * 100)}
                      r="1.8"
                      fill={lastPriceColor}
                      stroke="white"
                      strokeWidth="1"
                    />
                  )}

                  {/* Last dot (close) */}
                  {priceRange?.range > 0 && chartBars.length > 1 && (
                    <circle
                      cx="100"
                      cy={100 - clampPct(((lastC - yMin) / safeRange) * 100)}
                      r="2.2"
                      fill={lastPriceColor}
                      stroke="white"
                      strokeWidth="1"
                    />
                  )}
                </svg>
              </div>

              {/* Current-price reference line — full only */}
              {!compact && priceRange?.range > 0 && (
                <div
                  className="chart-ref-line"
                  style={{ bottom: `${currentPricePct}%`, '--ref-bg': lastPriceColor }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="panel-empty">No chart data available</div>
        )}
      </div>

      {/* Footer */}
      <div className="chart-footer">
        {compact ? (
          <>
            <span>{chartBars.length} bar history</span>
            {nextOpen && <span>Next Open: {nextOpen}</span>}
          </>
        ) : (
          <>
            <div>
              {safePriceHistory.length > 0 && (
                <span>{safePriceHistory[0]?.date} – {safePriceHistory[safePriceHistory.length - 1]?.date}</span>
              )}
            </div>
            <div className="chart-footer-kpis">
              {hasDistinctOHLC ? (
                <>
                  <span>O: ${Number(lastO).toFixed(2)}</span>
                  <span>H: ${Number(lastH).toFixed(2)}</span>
                  <span>L: ${Number(lastL).toFixed(2)}</span>
                  <span>C: ${Number(lastC).toFixed(2)}</span>
                </>
              ) : (
                <span>C: ${Number(lastC).toFixed(2)}</span>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  )
}
