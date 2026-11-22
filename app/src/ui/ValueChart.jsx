import { useEffect, useMemo, useRef, useState } from 'react'
import { money, moneyWhole, sessionDate } from './format'

const defaultTick = (v, step) => (step >= 1 ? moneyWhole(v) : money(v))

/** Up to `count` round tick values inside [lo, hi]. */
export function niceTicks(lo, hi, count = 3) {
  const raw = (hi - lo) / (count + 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out.length > count + 1 ? out.filter((_, i) => i % 2 === 1) : out
}

/**
 * Time-series line chart (SVG). Daily points are spaced evenly (trading days).
 *   points   [{ t: 'YYYY-MM-DD', v: number | null }]
 *   markers  [{ t, kind: 'buy' | 'sell', label }]   drawn on the line
 *   baseline number, drawn dashed (e.g. starting cash)
 *   variant  'full' | 'spark'
 */
export default function ValueChart({
  points,
  markers = [],
  baseline = null,
  baselineLabel = null,
  height = 220,
  variant = 'full',
  formatValue = money,
  formatTick = defaultTick,
  label,
  tone = 'accent',
}) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const spark = variant === 'spark'
  const pad = spark ? { t: 3, r: 3, b: 3, l: 3 } : { t: 12, r: 8, b: 26, l: 8 }
  const data = useMemo(() => (points ?? []).filter((p) => p && p.v !== null && p.v !== undefined && Number.isFinite(Number(p.v))), [points])

  const geo = useMemo(() => {
    if (!width || data.length === 0) return null
    const vals = data.map((p) => Number(p.v))
    if (baseline !== null && !spark) vals.push(baseline)
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (hi - lo < 1e-9) { const d = Math.abs(hi) * 0.01 || 1; lo -= d; hi += d }
    const span = hi - lo
    lo -= span * 0.12
    hi += span * 0.12
    const iw = width - pad.l - pad.r
    const ih = height - pad.t - pad.b
    const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw)
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ih
    const path = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(p.v)).toFixed(1)}`).join('')
    const ticks = niceTicks(lo, hi, 3)
    const index = new Map(data.map((p, i) => [p.t, i]))
    return { x, y, path, ticks, index, iw, ih }
  }, [width, data, baseline, height, spark, pad.l, pad.r, pad.t, pad.b])

  const onMove = (e) => {
    if (!geo || spark || data.length === 0) return
    const rect = ref.current.getBoundingClientRect()
    const cx = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left
    const i = data.length === 1 ? 0 : Math.round(((cx - pad.l) / geo.iw) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }

  const markerPts = geo
    ? markers
        .map((m) => ({ ...m, i: geo.index.get(String(m.t).slice(0, 10)) }))
        .filter((m) => m.i !== undefined)
    : []

  const lineClass = `tl-chart-line ${tone === 'neutral' ? 'tl-chart-line--neutral' : ''}`
  const h = hover !== null ? data[hover] : null
  const hoverMarkers = h ? markerPts.filter((m) => m.i === hover) : []
  const xLabels = data.length > 1 ? [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i) : [0]

  return (
    <div
      className="tl-chart"
      ref={ref}
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onMove}
      onTouchMove={onMove}
      onTouchEnd={() => setHover(null)}
      role="img"
      aria-label={label ?? (data.length ? `Chart from ${sessionDate(data[0].t)} (${formatValue(data[0].v)}) to ${sessionDate(data[data.length - 1].t)} (${formatValue(data[data.length - 1].v)})` : 'No data')}
    >
      {geo && (
        <svg width={width} height={height} aria-hidden="true">
          {!spark && geo.ticks.map((v) => (
            <g key={v}>
              <line className="tl-chart-grid" x1={pad.l} x2={width - pad.r} y1={geo.y(v)} y2={geo.y(v)} />
              <text className="tl-chart-axis" x={width - pad.r} y={geo.y(v) - 5} textAnchor="end">{formatTick(v, geo.ticks.length > 1 ? geo.ticks[1] - geo.ticks[0] : 1)}</text>
            </g>
          ))}
          {baseline !== null && !spark && (
            <g>
              <line className="tl-chart-base" x1={pad.l} x2={width - pad.r} y1={geo.y(baseline)} y2={geo.y(baseline)} />
              {baselineLabel && <text className="tl-chart-axis" x={pad.l} y={geo.y(baseline) - 5}>{baselineLabel}</text>}
            </g>
          )}
          {data.length > 1 && <path className={lineClass} d={geo.path} />}
          {data.length === 1 && <circle className="tl-chart-dot" cx={geo.x(0)} cy={geo.y(Number(data[0].v))} r={4} />}
          {markerPts.map((m, k) => (
            <circle
              key={`${m.t}-${k}`}
              className={`tl-chart-marker--${m.kind === 'sell' ? 'sell' : 'buy'}`}
              cx={geo.x(m.i)}
              cy={geo.y(Number(data[m.i].v))}
              r={spark ? 2.5 : 4.5}
              stroke="#fff"
              strokeWidth={spark ? 1 : 1.5}
            />
          ))}
          {!spark && xLabels.map((i) => (
            <text key={i} className="tl-chart-axis" x={geo.x(i)} y={height - 6} textAnchor={i === 0 && data.length > 1 ? 'start' : i === data.length - 1 && data.length > 1 ? 'end' : 'middle'}>
              {sessionDate(data[i].t)}
            </text>
          ))}
          {h && (
            <g>
              <line className="tl-chart-cross" x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.t} y2={height - pad.b} />
              <circle className="tl-chart-dot" cx={geo.x(hover)} cy={geo.y(Number(h.v))} r={4} />
            </g>
          )}
        </svg>
      )}
      {h && geo && (
        <div className="tl-chart-tip" style={{ left: Math.min(Math.max(geo.x(hover), 70), width - 70) }}>
          <span>{sessionDate(h.t, { year: true })}</span><br />
          {formatValue(h.v)}
          {hoverMarkers.map((m, k) => <div key={k}>{m.label}</div>)}
        </div>
      )}
    </div>
  )
}
