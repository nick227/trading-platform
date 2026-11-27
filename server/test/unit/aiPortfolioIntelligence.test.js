import { describe, it, expect, vi } from 'vitest'
import {
  evaluatePaperPortfolioIntelligence,
  evaluateHoldingThesisHealth,
  computeConcentrationMetrics
} from '../../src/services/ai/portfolioIntelligenceService.js'

function makeBars(endSession, { base = 100, step = 0.5 } = {}) {
  const dates = []
  let curr = new Date(endSession + 'T00:00:00Z')
  while (dates.length < 60) {
    const day = curr.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(curr.toISOString().slice(0, 10))
    curr = new Date(curr.getTime() - 86_400_000)
  }
  dates.reverse()
  return dates.map((d, idx) => {
    const close = Number((base + idx * step).toFixed(2))
    const open = Number((close - 0.2).toFixed(2))
    return [d, open, Number((close + 1).toFixed(2)), Number((open - 0.8).toFixed(2)), close, 1_500_000]
  })
}

describe('Intelligent Portfolio Management Service', () => {
  it('flags sector and single-position concentration accurately', () => {
    const metrics = computeConcentrationMetrics({
      totalEquity: 10000,
      maxPositionPct: 20,
      positions: [
        { symbol: 'NVDA', sector: 'Technology', marketValue: 2250 },
        { symbol: 'MSFT', sector: 'Technology', marketValue: 1850 }
      ]
    })

    expect(metrics.diversificationStatus).toBe('concentrated')
    expect(metrics.alerts.some(a => a.code === 'position_over_cap' && a.symbol === 'NVDA')).toBe(true)
    expect(metrics.alerts.some(a => a.code === 'position_near_cap' && a.symbol === 'MSFT')).toBe(true)
    expect(metrics.alerts.some(a => a.code === 'sector_concentration' && a.sector === 'Technology')).toBe(true)
  })

  it('detects thesis invalidation on AI SELL or stop-loss breach', () => {
    expect(evaluateHoldingThesisHealth({
      returnPct: -4.2,
      weightPct: 12,
      stopLossPct: 3.5,
      takeProfitPct: 8.0
    }).status).toBe('action_required')

    expect(evaluateHoldingThesisHealth({
      returnPct: 1.5,
      weightPct: 10,
      latestAiDecision: { action: 'SELL', thesis: 'Margin guidance cut' }
    }).status).toBe('action_required')

    expect(evaluateHoldingThesisHealth({
      returnPct: 5.5,
      weightPct: 11,
      indicators: { excess20Pct: 2.4, excess50Pct: 6.1 }
    }).status).toBe('strengthening')
  })

  it('evaluates open paper holdings and generates risk-validated EXIT and DIVERSIFY_CASH proposals', async () => {
    const session = '2026-11-25'
    const bot = {
      id: 'bot_platform_ai_stock_trader_v1',
      enabled: true,
      config: {
        allocatedAmount: 10000,
        execution: { maxPositionPct: 0.20, maxOrderNotional: 2000, maxOrdersPerCycle: 2 }
      }
    }

    const fills = [
      {
        id: 'exec_nvda_1',
        ticker: 'NVDA',
        direction: 'buy',
        status: 'filled',
        filledQuantity: 10,
        filledPrice: 150,
        fees: 0,
        commission: 0,
        filledAt: new Date('2026-11-20T14:50:00Z')
      }
    ]

    const mockPrisma = {
      bot: { findUnique: vi.fn(async () => bot) },
      execution: { findMany: vi.fn(async () => []) },
      executionAudit: {
        findMany: vi.fn(async () => [{
          executionId: 'exec_nvda_1',
          eventType: 'execution_created',
          metadata: {
            thesis: 'Data center demand expansion',
            exitRule: { stopLossPct: 4.0, takeProfitPct: 10.0 }
          }
        }])
      },
      botEvent: { findMany: vi.fn(async () => []) }
    }

    const mockEngine = {
      getDailyBars: vi.fn(async (sym) => {
        if (sym === 'SPY') return { bars: makeBars(session, { base: 480, step: 0.4 }) }
        // NVDA fell below -4% stop ($150 -> ~$138)
        if (sym === 'NVDA') return { bars: makeBars(session, { base: 155, step: -0.3 }) }
        return { bars: [] }
      }),
      getSessionClose: vi.fn(async (sym) => ({ session, close: sym === 'NVDA' ? 138 : 500 }))
    }

    const mockDiscovery = vi.fn(async () => ({
      discoveries: [
        {
          symbol: 'LLY',
          name: 'Eli Lilly & Co.',
          sector: 'Healthcare',
          themeLabel: 'Momentum Leader',
          rs20dPct: 6.4,
          indicators: { price: 800 }
        }
      ]
    }))

    const intel = await evaluatePaperPortfolioIntelligence({
      botId: bot.id,
      prismaClient: mockPrisma,
      engine: mockEngine,
      evidenceRegistry: { assemble: async () => ({ records: [] }) },
      fillLoader: async () => fills,
      discoveryProvider: mockDiscovery,
      session
    })

    expect(intel.status).toBe('ready')
    expect(intel.holdings).toHaveLength(1)
    expect(intel.holdings[0].symbol).toBe('NVDA')
    expect(intel.holdings[0].thesisHealth.status).toBe('action_required')

    const exitProposal = intel.allocationProposals.find(p => p.type === 'EXIT_POSITION' && p.symbol === 'NVDA')
    expect(exitProposal).toBeTruthy()
    expect(exitProposal.action).toBe('SELL')
    expect(exitProposal.quantity).toBe(10)
    expect(exitProposal.riskPolicyVerified).toBe(true)

    const diversifyProposal = intel.allocationProposals.find(p => p.type === 'DIVERSIFY_CASH' && p.symbol === 'LLY')
    expect(diversifyProposal).toBeTruthy()
    expect(diversifyProposal.action).toBe('BUY')
    expect(diversifyProposal.estimatedNotional).toBeLessThanOrEqual(2000)
  })
})
