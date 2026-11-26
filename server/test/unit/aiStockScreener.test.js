import { describe, expect, it, vi } from 'vitest'
import { scoreStockBars, screenAiStockUniverse } from '../../src/services/ai/stockScreener.js'

function makeBars(session = '2026-11-25', increment = 0.4) {
  const bars = []
  const end = Date.parse(session + 'T00:00:00Z')
  for (let i = 0; i < 70; i++) {
    const date = new Date(end - (69 - i) * 86_400_000).toISOString().slice(0, 10)
    const close = 100 + i * increment
    bars.push([date, close, close + 2, close - 2, close, 1_000_000])
  }
  return bars
}

describe('flagship AI stock screening', () => {
  it('uses deterministic technical rankings and alphabetical tie-breaking', async () => {
    const engine = { getDailyBars: vi.fn(async symbol => ({ bars: makeBars('2026-11-25', symbol === 'XYZ' ? 1 : 0.4) })) }
    const input = { engine, session: '2026-11-25', symbols: ['MSFT', 'AAPL', 'XYZ'], shortlistLimit: 2 }
    const a = await screenAiStockUniverse(input)
    const b = await screenAiStockUniverse({ ...input, symbols: [...input.symbols].reverse() })
    expect(a.shortlist.map(x => x.symbol)).toEqual(b.shortlist.map(x => x.symbol))
    expect(a.shortlist.map(x => x.symbol)).toEqual(['XYZ', 'AAPL'])
    expect(a.eligibleCount).toBe(3)
  })

  it('keeps holdings in context even if they rank below the shortlist', async () => {
    const engine = { getDailyBars: vi.fn(async () => ({ bars: makeBars() })) }
    const result = await screenAiStockUniverse({
      engine,
      session: '2026-11-25',
      symbols: ['AAPL', 'NVDA'],
      heldSymbols: ['TSLA'],
      shortlistLimit: 1
    })
    expect(result.shortlist.map(x => x.symbol)).toContain('TSLA')
    expect(result.shortlist.find(x => x.symbol === 'TSLA').held).toBe(true)
  })

  it('rejects future bars, stale sessions, invalid values and missing history', () => {
    const good = makeBars()
    expect(scoreStockBars('AAPL', good, '2026-11-25').eligible).toBe(true)
    expect(scoreStockBars('AAPL', [...good, ['2026-11-26', 1, 2, 1, 1, 1]], '2026-11-25').reason).toBe('future_data')
    expect(scoreStockBars('AAPL', good.slice(0, -1), '2026-11-25').reason).toBe('stale_data')
    expect(scoreStockBars('AAPL', good.slice(-20), '2026-11-25').reason).toBe('insufficient_history')
    const bad = makeBars()
    bad.at(-1)[4] = NaN
    expect(scoreStockBars('AAPL', bad, '2026-11-25').reason).toBe('invalid_bar')
  })

  it('fails safely on individual symbol data errors', async () => {
    const engine = { getDailyBars: vi.fn(async symbol => {
      if (symbol === 'NVDA') throw new Error('unavailable')
      return { bars: makeBars() }
    }) }
    const result = await screenAiStockUniverse({
      engine, session: '2026-11-25', symbols: ['NVDA', 'AAPL'], heldSymbols: ['NVDA']
    })
    expect(result.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: 'NVDA', reason: 'market_data_unavailable' })]))
    expect(result.shortlist.find(row => row.symbol === 'NVDA').held).toBe(true)
  })
})
