import { describe, expect, it, vi } from 'vitest'
import {
  createAiResearchToolRegistry, createDefaultAiResearchTools
} from '../../src/services/ai/researchToolGateway.js'

const ctx = () => ({
  asOfSession: '2026-11-25',
  screening: { shortlist: [
    { symbol: 'AAPL', eligible: true, indicators: { price: 100, sma20: 95 } },
    { symbol: 'MSFT', eligible: true, indicators: { price: 200, sma20: 190 } }
  ] },
  portfolio: { cash: 5000, totalEquity: 10000,
    positions: [{ symbol: 'AAPL', quantity: 50, marketValue: 5000 }] },
  engine: { getDailyBars: vi.fn(async () => ({ bars: [
    ['2026-11-24', 100, 101, 99, 100, 1000],
    ['2026-11-25', 101, 102, 100, 101, 1000]
  ] })) }
})

describe('MR 13 deterministic AI research tool gateway', () => {
  it('only permits definition-allowlisted functions', async () => {
    const session = createDefaultAiResearchTools().createSession({
      permittedTools: ['get_stock_metrics'], context: ctx()
    })
    const metrics = await session.execute('get_stock_metrics', { symbol: 'AAPL' })
    expect(metrics.indicators.price).toBe(100)
    await expect(session.execute('get_portfolio_state', {})).rejects.toMatchObject({
      code: 'tool_not_permitted'
    })
    await expect(session.execute('submit_order', { symbol: 'AAPL' })).rejects.toMatchObject({
      code: 'tool_not_permitted'
    })
  })

  it('prevents arbitrary symbols and unrecognized arguments', async () => {
    const s = createDefaultAiResearchTools().createSession({
      permittedTools: ['get_stock_metrics'], context: ctx()
    })
    await expect(s.execute('get_stock_metrics', { symbol: 'UNKNOWN' })).rejects.toMatchObject({ code: 'symbol_not_authorized' })
    await expect(s.execute('get_stock_metrics', { symbol: 'AAPL', url: 'http://attacker' })).rejects.toMatchObject({ code: 'unknown_arguments' })
  })

  it('returns a canonical comparison without asking the model to calculate', async () => {
    const session = createDefaultAiResearchTools().createSession({
      permittedTools: ['compare_candidates'], context: ctx()
    })
    const result = await session.execute('compare_candidates', { symbols: ['MSFT','AAPL'] })
    expect(result.candidates.map(x => x.symbol)).toEqual(['AAPL','MSFT'])
    expect(result.candidates[1].indicators.sma20).toBe(190)
  })

  it('enforces call count and caches same-session duplicate requests', async () => {
    const observed = []
    const session = createDefaultAiResearchTools().createSession({
      permittedTools: ['get_stock_metrics'], context: ctx(), maxCalls: 2,
      onTrace: event => { observed.push(event) }
    })
    await session.execute('get_stock_metrics', { symbol: 'AAPL' })
    await session.execute('get_stock_metrics', { symbol: 'AAPL' })
    expect(session.getTrace()[1].cached).toBe(true)
    expect(observed).toHaveLength(1)
    await expect(session.execute('get_stock_metrics', { symbol: 'MSFT' })).rejects.toMatchObject({
      code: 'tool_call_limit'
    })
  })

  it('forbids future-dated bars, unsupported lookback and unchecked large outputs', async () => {
    const input = ctx()
    input.engine.getDailyBars = async () => ({ bars: [['2026-11-26', 100, 101, 99, 100, 1000]] })
    const s = createDefaultAiResearchTools().createSession({
      permittedTools: ['get_historical_prices'], context: input
    })
    await expect(s.execute('get_historical_prices', { symbol: 'AAPL', lookbackDays: 150 })).rejects.toMatchObject({ code: 'invalid_lookback' })
    await expect(s.execute('get_historical_prices', { symbol: 'AAPL', lookbackDays: 7 })).rejects.toMatchObject({ code: 'research_tool_unavailable' })
    const large = createAiResearchToolRegistry().register({
      id: 'huge_tool', version: '1', validate: args => args,
      run: () => ({ text: 'x'.repeat(20000) })
    })
    const l = large.createSession({ permittedTools: ['huge_tool'], context: ctx() })
    await expect(l.execute('huge_tool', {})).rejects.toMatchObject({ code: 'tool_output_budget_exceeded' })
  })

  it('never accepts an arbitrary research tool as a duplicate registration', () => {
    const registry = createDefaultAiResearchTools()
    expect(() => registry.register({
      id: 'get_stock_metrics', version: '2', validate: x => x, run: () => ({})
    })).toThrow()
  })
})
