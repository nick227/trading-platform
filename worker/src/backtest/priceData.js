/**
 * Historical price validation and normalization for backtests. Pure: no I/O.
 *
 * Input: Alpha Engine clean session bars per ticker ([date, open, high, low, close, volume])
 * plus a reference calendar ticker. Output: bars on one consistent price basis, with every
 * change recorded. Nothing is silently repaired:
 *   - duplicate dates      → one bar kept (the last), recorded
 *   - malformed OHLC/volume→ bar dropped, recorded
 *   - split discontinuity  → a close-to-close ratio within 8% of 1/k or k for a standard split
 *                            factor k: earlier bars are back-adjusted by k (prices ÷k, volume ×k),
 *                            recorded with the date and factor
 *   - unexplained jump     → a daily move beyond ±60% that is not a split: the ticker is unusable
 *   - missing sessions     → sessions in the reference calendar (within the ticker's coverage)
 *                            with no bar: recorded; no decision or fill for that ticker that day
 *   - availability         → first and last bar date per ticker; nothing before the first
 */
import { createHash } from 'node:crypto'

export const SPLIT_FACTORS = [2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 50]
const SPLIT_TOLERANCE = 0.08
const MAX_PLAUSIBLE_MOVE = 0.6

const r6 = (n) => Math.round(n * 1e6) / 1e6

function splitFactor(ratio) {
  for (const k of SPLIT_FACTORS) {
    if (Math.abs(ratio * k - 1) <= SPLIT_TOLERANCE) return { factor: k, kind: 'split' }        // price ÷k
    if (Math.abs(ratio / k - 1) <= SPLIT_TOLERANCE) return { factor: 1 / k, kind: 'reverse_split' } // price ×k
  }
  return null
}

function wellFormed(b) {
  const [, o, h, l, c, v] = b
  return [o, h, l, c].every((x) => Number.isFinite(x) && x > 0) && Number.isFinite(v) && v >= 0 &&
    l <= Math.min(o, c) + 1e-6 && h >= Math.max(o, c) - 1e-6
}

/** Normalizes one ticker's bars. Returns { bars, issues, usable }. */
export function normalizeTicker(ticker, raw) {
  const issues = []
  const byDate = new Map()
  for (const b of raw ?? []) {
    if (byDate.has(b[0])) issues.push({ ticker, type: 'duplicate_date', date: b[0] })
    byDate.set(b[0], b.map((x, i) => (i === 0 ? x : Number(x))))
  }
  let bars = [...byDate.keys()].sort().map((d) => byDate.get(d))
  bars = bars.filter((b) => {
    if (wellFormed(b)) return true
    issues.push({ ticker, type: 'malformed_bar_dropped', date: b[0] })
    return false
  })

  // Walk backwards so each adjustment applies to everything before its date.
  let usable = true
  for (let i = bars.length - 1; i >= 1; i--) {
    const ratio = bars[i][4] / bars[i - 1][4]
    if (Math.abs(ratio - 1) <= MAX_PLAUSIBLE_MOVE && ratio >= 1 / (1 + MAX_PLAUSIBLE_MOVE)) continue
    const split = splitFactor(ratio)
    if (!split) {
      usable = false
      issues.push({ ticker, type: 'unexplained_jump', date: bars[i][0], ratio: r6(ratio) })
      continue
    }
    for (let j = 0; j < i; j++) {
      const b = bars[j]
      bars[j] = [b[0], r6(b[1] / split.factor), r6(b[2] / split.factor), r6(b[3] / split.factor), r6(b[4] / split.factor), Math.round(b[5] * split.factor)]
    }
    issues.push({ ticker, type: 'price_basis_adjusted', kind: split.kind, date: bars[i][0], observedRatio: r6(ratio),
      factor: split.factor >= 1 ? split.factor : r6(split.factor), note: 'earlier bars back-adjusted to the later price basis' })
  }
  return { bars, issues, usable }
}

/**
 * Validates every ticker against the reference calendar.
 * Returns { bars: { T: [...] }, calendar: [dates], availability: { T: { first, last } }, issues, unusable: [T] }.
 */
export function normalizeDataset(rawByTicker, { calendarTicker }) {
  const out = { bars: {}, availability: {}, issues: [], unusable: [] }
  for (const [t, raw] of Object.entries(rawByTicker)) {
    const n = normalizeTicker(t, raw)
    out.bars[t] = n.bars
    out.issues.push(...n.issues)
    if (!n.usable || n.bars.length === 0) out.unusable.push(t)
    out.availability[t] = n.bars.length ? { first: n.bars[0][0], last: n.bars[n.bars.length - 1][0], sessions: n.bars.length } : null
  }
  const calendar = (out.bars[calendarTicker] ?? []).map((b) => b[0])
  out.calendar = calendar
  for (const [t, bars] of Object.entries(out.bars)) {
    if (!bars.length) continue
    const have = new Set(bars.map((b) => b[0]))
    const missing = calendar.filter((d) => d >= bars[0][0] && d <= bars[bars.length - 1][0] && !have.has(d))
    if (missing.length) out.issues.push({ ticker: t, type: 'missing_sessions', count: missing.length, dates: missing.slice(0, 20) })
    const extra = bars.filter((b) => !calendar.includes(b[0])).map((b) => b[0])
    if (extra.length && t !== calendarTicker) out.issues.push({ ticker: t, type: 'off_calendar_bars_ignored', count: extra.length, dates: extra.slice(0, 20) })
  }
  return out
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}

/** sha256 of everything a run's prices depend on (normalized bars, regimes, issues). */
export function dataFingerprint(parts) {
  return createHash('sha256').update(canonical(parts)).digest('hex')
}

/** 20-session average volume before `index` (Alpha Engine's avgVolume20 definition), or null. */
export function avgVolume20(bars, index) {
  // Same as Alpha Engine session-close: positive volumes before this session, last 20 of them.
  const prior = bars.slice(0, index).map((b) => b[5]).filter((v) => v > 0).slice(-20)
  return prior.length ? Math.round((prior.reduce((s, v) => s + v, 0) / prior.length) * 100) / 100 : null
}
