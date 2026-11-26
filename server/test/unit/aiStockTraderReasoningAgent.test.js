import { describe, expect, it, vi } from 'vitest'
import { runStockTraderResearch } from '../../src/services/ai/stockTraderResearchService.js'
import { createAiStockTraderAgentConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'
import { validateResearchPlan } from '../../src/services/ai/stockTraderReasoningAgent.js'

const session = '2026-11-25'
const screening = {
  asOfSession: session,
  shortlist: [
    { symbol: 'AAPL', eligible: true, inUniverse: true, indicators: { price: 100, sma20: 95 } },
    { symbol: 'MSFT', eligible: true, inUniverse: true, indicators: { price: 200, sma20: 195 } }
  ], ranking: [], excluded: []
}
const portfolioSnapshot = { asOfSession: session, cash: 10000, positions: [] }
const finalDecision = {
  marketSummary: 'Evidence favors a cautious small entry.',
  decisions: [
    { symbol: 'AAPL', action: 'BUY', confidence: 0.75, targetAllocationPct: 0.10,
      thesis: 'Broad supportive evidence', evidence: ['Price above moving average'],
      risks: ['Market reversal'], exitRule: { takeProfitPct: 8, stopLossPct: 4 } },
    { symbol: 'MSFT', action: 'HOLD', confidence: 0.5, targetAllocationPct: 0,
      thesis: 'Insufficient differentiation', evidence: [], risks: ['Uncertainty'] }
  ]
}
const planner = {
  focus: 'Compare competing holdings, then inspect AAPL',
  requests: [
    { toolId: 'compare_candidates', args: { symbols: ['MSFT', 'AAPL'] } },
    { toolId: 'get_stock_metrics', args: { symbol: 'AAPL' } }
  ]
}

function fixtures(plan = planner) {
  const config = createAiStockTraderAgentConfig()
  const bot = { id: 'bot-agent', portfolioId: 'portfolio-agent', enabled: true, config }
  const portfolio = { id: 'portfolio-agent' }
  let persisted
  const prismaClient = { botEvent: {
    findUnique: vi.fn(async () => persisted || null),
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }) => { persisted = data; return data }),
    updateMany: vi.fn(async ({ data }) => { persisted = { ...persisted, ...data }; return { count: 1 } })
  } }
  const provider = { completeStructured: vi.fn(async ({ systemPrompt, userPrompt }) => {
    if (systemPrompt.includes('Choose at most')) {
      return { model: 'mock', usage: { prompt_tokens: 200, completion_tokens: 80 }, structured: plan }
    }
    expect(systemPrompt).toMatch(/Evaluate the significance of tool evidence/)
    expect(userPrompt).toContain('investigation')
    return { model: 'mock', usage: { prompt_tokens: 600, completion_tokens: 400 }, structured: finalDecision }
  }) }
  let sequence = 0
  const usageGovernor = {
    reserve: vi.fn(async ({ botId }) => ({ id: 'reservation-' + ++sequence, botId, period: '2026-11', reservedCents: 5 })),
    settle: vi.fn(async () => ({ settled: true }))
  }
  return { bot, portfolio, prismaClient, provider, usageGovernor }
}

describe('MR 14 vanilla AI research decision brain', () => {
  it('chooses deterministic research, uses results, then makes one final decision', async () => {
    const f = fixtures()
    const a = await runStockTraderResearch({
      ...f, screening, portfolioSnapshot
    })
    expect(a.ok).toBe(true)
    expect(a.investigation.providerCalls).toBe(2)
    expect(a.investigation.plan.requests).toHaveLength(2)
    expect(a.investigation.toolTrace).toHaveLength(2)
    expect(a.decision.actionable[0].symbol).toBe('AAPL')
    expect(f.provider.completeStructured).toHaveBeenCalledTimes(2)
    expect(f.usageGovernor.reserve).toHaveBeenCalledTimes(2)
    expect(f.usageGovernor.settle).toHaveBeenCalledTimes(2)
    const b = await runStockTraderResearch({ ...f, screening, portfolioSnapshot })
    expect(b.cached).toBe(true)
    expect(f.provider.completeStructured).toHaveBeenCalledTimes(2)
    expect(f.prismaClient.botEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({
        investigation: expect.objectContaining({ providerCalls: 2 })
      }) })
    }))
  })

  it('does not allow tools to request orders or unauthorized research', async () => {
    expect(() => validateResearchPlan({
      requests: [{ toolId: 'place_order', args: { ticker: 'AAPL' } }]
    }, ['get_stock_metrics'])).toThrow(/unauthorized/)
    const f = fixtures({ focus: 'Invalid', requests: [
      { toolId: 'place_order', args: { ticker: 'AAPL' } }
    ] })
    await expect(runStockTraderResearch({
      ...f, screening, portfolioSnapshot
    })).rejects.toThrow(/unauthorized/)
    expect(f.provider.completeStructured).toHaveBeenCalledTimes(1)
    expect(f.usageGovernor.reserve).toHaveBeenCalledTimes(1)
  })

  it('allows reasoned abstention without performing extra research-tool calls', async () => {
    const f = fixtures({ focus: 'No strong signal', requests: [] })
    const r = await runStockTraderResearch({
      ...f, screening, portfolioSnapshot
    })
    expect(r.ok).toBe(true)
    expect(r.investigation.toolUsage.calls).toBe(0)
    expect(r.investigation.results).toEqual([])
    expect(f.provider.completeStructured).toHaveBeenCalledTimes(2)
  })

  it('preserves unchanged legacy single-call behavior for pinned 1.0.0 instances', async () => {
    const { createAiStockTraderConfig } = await import('../../src/services/ai/strategies/aiStockTraderStrategy.js')
    const f = fixtures()
    f.bot.config = createAiStockTraderConfig()
    f.provider.completeStructured.mockResolvedValue({
      model: 'mock', usage: { prompt_tokens: 10, completion_tokens: 100 }, structured: finalDecision
    })
    const result = await runStockTraderResearch({ ...f, screening, portfolioSnapshot })
    expect(result.ok).toBe(true)
    expect(result.investigation).toBeUndefined()
    expect(f.provider.completeStructured).toHaveBeenCalledTimes(1)
  })
})
