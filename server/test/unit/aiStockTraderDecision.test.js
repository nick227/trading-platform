import { describe, expect, it, vi } from 'vitest'
import { buildStockTraderPrompts, validateStockTraderDecision } from '../../src/services/ai/strategies/stockTraderDecision.js'
import { runStockTraderResearch } from '../../src/services/ai/stockTraderResearchService.js'
import { createDefaultStockTraderContextRegistry } from '../../src/services/ai/stockTraderContext.js'
import { createAiStockTraderConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const session = '2026-11-25'
const screening = { asOfSession: session, shortlist: [
  { symbol: 'AAPL', eligible: true, inUniverse: true, score: 10 },
  { symbol: 'MSFT', eligible: true, inUniverse: true, score: 9 }
], ranking: [], excluded: [] }
const portfolioSnapshot = { asOfSession: session, cash: 10000, positions: [] }
const decision = () => ({ marketSummary: 'Neutral market', decisions: [
  { symbol: 'AAPL', action: 'BUY', confidence: 0.72, targetAllocationPct: 0.1, thesis: 'Momentum improving', evidence: ['Positive 20d trend'], risks: ['Volatility'], exitRule: { takeProfitPct: 8, stopLossPct: 4 } },
  { symbol: 'MSFT', action: 'HOLD', confidence: 0.55, targetAllocationPct: 0, thesis: 'Insufficient edge', evidence: [], risks: [] }
] })
const makeSnapshot = async () => createDefaultStockTraderContextRegistry().assemble({
  session, input: { screening, portfolio: portfolioSnapshot, config: createAiStockTraderConfig() }
})

describe('AI stock trader decisions', () => {
  it('produces a constrained prompt and validates full coverage', async () => {
    const snapshot = await makeSnapshot()
    const prompts = buildStockTraderPrompts(snapshot)
    expect(prompts.systemPrompt).toMatch(/Never invent/)
    expect(prompts.userPrompt).toContain('AAPL')
    expect(validateStockTraderDecision(decision(), snapshot).actionable).toHaveLength(1)
  })

  it('rejects invented symbols, duplicates, arbitrary sells and excessive trades', async () => {
    const snapshot = await makeSnapshot()
    const bad = decision()
    bad.decisions[1].symbol = 'TSLA'
    expect(() => validateStockTraderDecision(bad, snapshot)).toThrow()
    bad.decisions[1].symbol = 'AAPL'
    expect(() => validateStockTraderDecision(bad, snapshot)).toThrow()
    bad.decisions[1].symbol = 'MSFT'
    bad.decisions[1].action = 'SELL'
    expect(() => validateStockTraderDecision(bad, snapshot)).toThrow(/holding/)
  })

  it('uses one provider call and reuses completed decisions', async () => {
    const config = createAiStockTraderConfig()
    const bot = { id: 'bot-test', portfolioId: 'portfolio-test', enabled: true, config }
    const portfolio = { id: 'portfolio-test' }
    const provider = { completeStructured: vi.fn().mockResolvedValue({ model: 'mock', usage: { total_tokens: 50 }, structured: decision() }) }
    let persisted
    const prismaClient = { botEvent: {
      findUnique: vi.fn(async () => persisted ?? null),
      create: vi.fn(async ({ data }) => { persisted = data; return data }),
      updateMany: vi.fn(async ({ data }) => { persisted = { ...persisted, ...data }; return { count: 1 } })
    } }
    const opts = { bot, portfolio, screening, portfolioSnapshot, provider, prismaClient }
    const first = await runStockTraderResearch(opts)
    const second = await runStockTraderResearch(opts)
    expect(first.ok).toBe(true)
    expect(second.cached).toBe(true)
    expect(provider.completeStructured).toHaveBeenCalledTimes(1)
  })
})
