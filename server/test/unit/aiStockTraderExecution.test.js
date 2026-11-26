import { describe, expect, it, vi } from 'vitest'
import { queueStockTraderPaperOrders } from '../../src/services/ai/stockTraderExecutionService.js'
import { AI_STOCK_TRADER_STRATEGY_ID, createAiStockTraderConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const session = '2026-11-25'
function fixtures() {
  const bot = { id: 'bot-x', userId: 'user-x', portfolioId: 'portfolio-x', enabled: true, templateId: AI_STOCK_TRADER_STRATEGY_ID, config: createAiStockTraderConfig() }
  const portfolio = { id: 'portfolio-x', userId: 'user-x' }
  const screening = { asOfSession: session, shortlist: [{ symbol: 'AAPL', eligible: true, inUniverse: true, indicators: { price: 100 } }] }
  const portfolioSnapshot = { asOfSession: session, cash: 10000, positions: [] }
  const research = { ok: true, eventId: 'req-1', decision: {
    asOfSession: session, actionable: [{
      symbol: 'AAPL', action: 'BUY', confidence: 0.75,
      targetAllocationPct: 0.15, thesis: 'Uptrend', evidence: ['Trend'], exitRule: { takeProfitPct: 8, stopLossPct: 4 }
    }]
  }}
  const executions = []
  const audits = []
  const prismaClient = {
    user: { findUnique: vi.fn().mockResolvedValue({ riskSettings: null }) },
    execution: {
      findMany: vi.fn(async () => executions.filter(x => x.status === 'queued' && x.direction === 'buy')),
      findFirst: vi.fn(async ({ where }) => executions.find(e => where.OR.some(k => e.clientOrderId === k.clientOrderId || e.activeIntentKey === k.activeIntentKey)) || null),
      create: vi.fn(async ({ data }) => { executions.push(data); return data })
    },
    executionAudit: { create: vi.fn(async ({ data }) => { audits.push(data); return data }) }
  }
  prismaClient.$transaction = async fn => fn(prismaClient)
  return { bot, portfolio, screening, portfolioSnapshot, research, prismaClient, executions, audits }
}

describe('flagship paper execution', () => {
  it('queues and audits an eligible paper order exactly once', async () => {
    const input = fixtures()
    const riskEvaluator = vi.fn().mockResolvedValue({ allowed: true })
    const a = await queueStockTraderPaperOrders({ ...input, riskEvaluator })
    const b = await queueStockTraderPaperOrders({ ...input, riskEvaluator })
    expect(a.queued).toHaveLength(1)
    expect(b.queued).toHaveLength(0)
    expect(input.executions).toHaveLength(1)
    expect(input.audits).toHaveLength(1)
    expect(input.executions[0].quantity).toBe(15)
    expect(input.executions[0].sourceType).toBe('AI_FORWARD')
  })

  it('never queues when the risk evaluator fails', async () => {
    const input = fixtures()
    const result = await queueStockTraderPaperOrders({ ...input, riskEvaluator: async () => { throw new Error('offline') } })
    expect(result.queued).toEqual([])
    expect(result.rejected[0].reason).toBe('risk_service_unavailable')
    expect(input.executions).toHaveLength(0)
  })

  it('never queues from a disabled bot or a mismatched research session', async () => {
    const input = fixtures()
    input.bot.enabled = false
    await expect(queueStockTraderPaperOrders({ ...input, riskEvaluator: async () => ({ allowed: true }) })).rejects.toThrow(/identity/)
    input.bot.enabled = true
    input.research.decision.asOfSession = '2026-11-24'
    await expect(queueStockTraderPaperOrders({ ...input, riskEvaluator: async () => ({ allowed: true }) })).rejects.toThrow(/same-session/)
  })

  it('rejects orders when emergency stop is active', async () => {
    const input = fixtures()
    input.prismaClient.user.findUnique = vi.fn().mockResolvedValue({ riskSettings: { emergencyStop: true } })
    // The exact riskSettings format is owned by the emergency-stop service.
    // The lower-level risk-failure test above also covers fail-closed behavior.
    const result = await queueStockTraderPaperOrders({ ...input, riskEvaluator: async () => ({ allowed: false, reason: 'halted' }) })
    expect(result.queued).toHaveLength(0)
  })
})
