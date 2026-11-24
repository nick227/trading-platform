import { describe, it, expect } from 'vitest'
import { normalizeTicker, normalizeDataset, dataFingerprint, avgVolume20 } from '../../../worker/src/backtest/priceData.js'

const day = (i) => new Date(Date.UTC(2023, 10, 1 + i)).toISOString().slice(0, 10)
const bar = (i, c, v = 1e6) => [day(i), c, c * 1.01, c * 0.99, c, v]

describe('historical price normalization', () => {
  it('detects a 10:1 price-basis break (staging NVDA, 0.1019 on 2023-11-20) and back-adjusts earlier bars', () => {
    const raw = [bar(0, 480), bar(1, 492), bar(2, 50.1), bar(3, 51)] // 50.1/492 = 0.1018
    const n = normalizeTicker('NVDA', raw)
    expect(n.usable).toBe(true)
    expect(n.bars.map((b) => b[4])).toEqual([48, 49.2, 50.1, 51])
    expect(n.bars[0][5]).toBe(1e7) // volume ×10
    expect(n.issues).toEqual([expect.objectContaining({ type: 'price_basis_adjusted', kind: 'split', date: day(2), factor: 10 })])
  })
  it('handles reverse splits, and rejects a jump that is not a split', () => {
    expect(normalizeTicker('X', [bar(0, 10), bar(1, 10.1), bar(2, 101)]).bars.map((b) => b[4])).toEqual([100, 101, 101])
    const bad = normalizeTicker('Y', [bar(0, 100), bar(1, 300)]) // ×3 is a reverse 1:3 → allowed; ×2.6 is not
    expect(bad.usable).toBe(true)
    const odd = normalizeTicker('Z', [bar(0, 100), bar(1, 260)])
    expect(odd.usable).toBe(false)
    expect(odd.issues[0]).toMatchObject({ type: 'unexplained_jump', ratio: 2.6 })
  })
  it('keeps one bar per date and drops malformed bars, recording both', () => {
    const n = normalizeTicker('A', [bar(0, 10), bar(0, 11), [day(1), 10, 9, 11, 10, 5], bar(2, 10)])
    expect(n.bars.map((b) => [b[0], b[4]])).toEqual([[day(0), 11], [day(2), 10]])
    expect(n.issues.map((i) => i.type)).toEqual(['duplicate_date', 'malformed_bar_dropped'])
  })
  it('records missing sessions against the reference calendar and each ticker’s availability', () => {
    const ds = normalizeDataset({ SPY: [bar(0, 1), bar(1, 1), bar(2, 1), bar(3, 1)], META: [bar(1, 1), bar(3, 1)] }, { calendarTicker: 'SPY' })
    expect(ds.calendar).toHaveLength(4)
    expect(ds.availability.META).toMatchObject({ first: day(1), last: day(3), sessions: 2 })
    expect(ds.issues).toContainEqual({ ticker: 'META', type: 'missing_sessions', count: 1, dates: [day(2)] })
  })
  it('fingerprints content deterministically and matches Alpha Engine’s avgVolume20', () => {
    expect(dataFingerprint({ b: 1, a: [1, 2] })).toBe(dataFingerprint({ a: [1, 2], b: 1 }))
    expect(dataFingerprint({ a: 1 })).not.toBe(dataFingerprint({ a: 2 }))
    const bars = Array.from({ length: 25 }, (_, i) => bar(i, 10, i === 3 ? 0 : 100 + i))
    expect(avgVolume20(bars, 24)).toBe(Math.round(([...Array(24).keys()].filter((i) => i !== 3).slice(-20).reduce((s, i) => s + 100 + i, 0) / 20) * 100) / 100)
    expect(avgVolume20(bars, 0)).toBeNull()
  })
})
