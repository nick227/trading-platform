import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import prisma from '../../src/loaders/prisma.js'
import { registerCustomProvider } from '../../src/services/ai/providers/providerRegistry.js'
import { MockLLMProvider } from '../../src/services/ai/providers/mockProvider.js'
import { executeAiStrategyCycle, getOrCreateCanonicalAiBot, getAiDecisionsHistory, nextTradingSession } from '../../src/services/ai/aiBotService.js'
import { validateAiDecisionOutput } from '../../src/services/ai/strategies/catalystMomentumStrategy.js'
import { getPublicStrategy, listPublicStrategies } from '../../src/services/strategyEvidenceService.js'
import { SimulatedBroker } from '../../../worker/src/broker/simulatedBroker.js'
import createFastifyApp from '../../src/loaders/fastify.js'
import registerRoutes from '../../src/loaders/routes.js'

describe('AI Catalyst & Momentum Strategy Integration', () => {
  const origBrokerMode = process.env.BROKER_MODE
  const origSimSession = process.env.SIM_REPLAY_SESSION

  beforeEach(async () => {
    process.env.BROKER_MODE = 'simulated'
    process.env.SIM_REPLAY_SESSION = 'latest'
    // Ensure clean state for AI bot executions
    const { bot } = await getOrCreateCanonicalAiBot({ prismaClient: prisma })
    await prisma.executionAudit.deleteMany({ where: { execution: { botId: bot.id } } })
    await prisma.botEvent.deleteMany({ where: { botId: bot.id } })
    await prisma.execution.deleteMany({ where: { botId: bot.id } })
  })

  afterEach(() => {
    process.env.BROKER_MODE = origBrokerMode
    process.env.SIM_REPLAY_SESSION = origSimSession
  })

  it('computes nextTradingSession correctly avoiding look-ahead', () => {
    // Friday rolls to Monday
    expect(nextTradingSession('2026-11-20')).toBe('2026-11-23')
    // Monday rolls to Tuesday
    expect(nextTradingSession('2026-11-23')).toBe('2026-11-24')
  })

  it('validates and sanitizes AI decision schema enforcing universe and rules', () => {
    const context = {
      asOfSession: '2026-11-20',
      symbols: [{ symbol: 'SPY' }, { symbol: 'NVDA' }, { symbol: 'AAPL' }],
      portfolio: {
        allocatedCapital: 10000,
        cash: 10000,
        positions: [{ symbol: 'AAPL', quantity: 10 }]
      }
    }

    const rawOutput = {
      asOfSession: '2026-11-20',
      marketSummary: 'Consolidating near resistance',
      symbolEvaluations: [
        {
          symbol: 'NVDA',
          action: 'BUY',
          confidence: 0.85,
          targetAllocationPct: 0.15,
          thesis: 'Datacenter momentum',
          evidence: ['Above SMA20']
        },
        {
          symbol: 'AAPL',
          action: 'SELL',
          confidence: 0.70,
          thesis: 'Reversal detected',
          evidence: ['Below SMA50']
        },
        {
          symbol: 'SPY',
          action: 'HOLD',
          confidence: 0.60,
          thesis: 'Neutral market',
          evidence: ['Choppy index action']
        }
      ],
      selectedDecisions: [
        {
          symbol: 'NVDA',
          action: 'BUY',
          confidence: 0.85,
          targetAllocationPct: 0.15,
          thesis: 'Datacenter momentum',
          evidence: ['Above SMA20']
        },
        {
          symbol: 'AAPL',
          action: 'SELL',
          confidence: 0.70,
          thesis: 'Reversal detected',
          evidence: ['Below SMA50']
        }
      ]
    }

    const sanitized = validateAiDecisionOutput(rawOutput, context)
    expect(sanitized.symbolEvaluations).toHaveLength(3)
    expect(sanitized.selectedDecisions).toHaveLength(2)
    expect(sanitized.selectedDecisions[0].symbol).toBe('NVDA')
    expect(sanitized.selectedDecisions[0].action).toBe('BUY')
    expect(sanitized.selectedDecisions[1].symbol).toBe('AAPL')
    expect(sanitized.selectedDecisions[1].action).toBe('SELL')
  })

  it('blocks SELL orders for symbols not currently held', () => {
    const context = {
      asOfSession: '2026-11-20',
      symbols: [{ symbol: 'SPY' }, { symbol: 'NVDA' }],
      portfolio: {
        allocatedCapital: 10000,
        cash: 10000,
        positions: [] // Empty portfolio
      }
    }

    const rawOutput = {
      asOfSession: '2026-11-20',
      marketSummary: 'Risk-off market',
      symbolEvaluations: [
        { symbol: 'NVDA', action: 'SELL', confidence: 0.8, thesis: 'No holding' }
      ],
      selectedDecisions: [
        { symbol: 'NVDA', action: 'SELL', confidence: 0.8, thesis: 'No holding' }
      ]
    }

    const sanitized = validateAiDecisionOutput(rawOutput, context)
    // Selected decisions should filter out the invalid SELL
    expect(sanitized.selectedDecisions).toHaveLength(0)
  })

  it('executes AI cycle, records audit trail, and queues valid executable orders', { timeout: 15_000 }, async () => {
    const mockDecision = {
      asOfSession: '2026-11-20',
      marketSummary: 'Selective opportunity in megacap tech',
      symbolEvaluations: [
        {
          symbol: 'SPY',
          action: 'HOLD',
          confidence: 0.65,
          targetAllocationPct: 0,
          entryType: 'next_open',
          exitRule: { takeProfitPct: 6, stopLossPct: 3 },
          thesis: 'Index consolidating, preserve cash',
          evidence: ['SPY neutral trend']
        },
        {
          symbol: 'NVDA',
          action: 'BUY',
          confidence: 0.88,
          targetAllocationPct: 0.15,
          entryType: 'next_open',
          exitRule: { takeProfitPct: 10, stopLossPct: 4 },
          thesis: 'Strong AI datacenter demand with volume expansion',
          evidence: ['Volume ratio 1.5x', 'Strong cash flow guidance']
        }
      ],
      selectedDecisions: [
        {
          symbol: 'NVDA',
          action: 'BUY',
          confidence: 0.88,
          targetAllocationPct: 0.15,
          entryType: 'next_open',
          exitRule: { takeProfitPct: 10, stopLossPct: 4 },
          thesis: 'Strong AI datacenter demand with volume expansion',
          evidence: ['Volume ratio 1.5x', 'Strong cash flow guidance']
        }
      ]
    }

    registerCustomProvider('test_mock', new MockLLMProvider({ fixedResponse: mockDecision }))

    const { bot } = await getOrCreateCanonicalAiBot({ prismaClient: prisma })

    const res = await executeAiStrategyCycle({
      botId: bot.id,
      session: '2026-11-20',
      providerName: 'test_mock',
      dryRun: false,
      prismaClient: prisma
    })

    expect(res.ok).toBe(true)
    expect(res.model).toBe('mock-llm-v1')
    expect(res.evaluationsCount).toBe(2)
    expect(res.holdCount).toBe(1)
    expect(res.actionableCount).toBe(1)
    expect(res.createdExecutions).toHaveLength(1)

    const created = res.createdExecutions[0]
    expect(created.symbol).toBe('NVDA')
    expect(created.direction).toBe('buy')
    expect(created.targetSession).toBe('2026-11-23') // Next session after Friday 2026-11-20

    // Verify execution exists in DB
    const dbExec = await prisma.execution.findUnique({ where: { id: created.id } })
    expect(dbExec).not.toBeNull()
    expect(dbExec.ticker).toBe('NVDA')
    expect(dbExec.direction).toBe('buy')
    expect(dbExec.status).toBe('queued')
    expect(dbExec.simSession).toBe('2026-11-23')

    // Process the execution through the simulated broker (mocking the next session close when it arrives)
    const broker = new SimulatedBroker(bot.userId, {
      config: { enabled: true, mode: 'paper_daily', startingCash: 100_000, referenceTicker: 'SPY' },
      sessionClose: async (t, s) => ({ session: s, close: 142.50 }),
      resolveSession: async () => '2026-11-23'
    })
    const filled = await broker.submitOrder({
      ticker: dbExec.ticker,
      side: dbExec.direction,
      qty: dbExec.quantity,
      clientOrderId: dbExec.clientOrderId
    })

    expect(filled.status).toBe('filled')
    expect(filled.filledQty).toBe(dbExec.quantity)
    expect(filled.filledAvgPrice).toBeGreaterThan(0)
    expect(filled.simulation.session).toBe('2026-11-23')

    // Update execution status to reflect fill
    await prisma.execution.update({
      where: { id: created.id },
      data: {
        status: 'filled',
        filledQuantity: filled.filledQty,
        filledPrice: filled.filledAvgPrice,
        brokerOrderId: filled.alpacaOrderId,
        filledAt: new Date()
      }
    })

    const updatedExec = await prisma.execution.findUnique({ where: { id: created.id } })
    expect(updatedExec.status).toBe('filled')

    // Verify audit events exist in BotEvent
    const events = await getAiDecisionsHistory(bot.id)
    expect(events.length).toBeGreaterThanOrEqual(1)
    const cycleEvent = events.find(e => e.metadata?.model)
    expect(cycleEvent).toBeDefined()
    expect(cycleEvent.metadata.model).toBe('mock-llm-v1')
    expect(cycleEvent.metadata.strategy).toBe('tmpl_ai_catalyst_momentum')
  })

  it('serves AI strategy in public catalog and strategy detail without login', async () => {
    const list = await listPublicStrategies()
    const aiStrat = list.find(s => s.templateId === 'tmpl_ai_catalyst_momentum')
    expect(aiStrat).toBeDefined()
    expect(aiStrat.name).toBe('AI Catalyst & Momentum')
    expect(aiStrat.tags).toContain('ai')
    if (aiStrat.version) {
      expect(aiStrat.version.backtestable).toBe(false)
      expect(aiStrat.version.reason).toContain('Autonomous AI strategies are evaluated on verified forward paper trading')
    }

    const detail = await getPublicStrategy('tmpl_ai_catalyst_momentum')
    expect(detail).not.toBeNull()
    expect(detail.name).toBe('AI Catalyst & Momentum')
    expect(detail.definition.config.signalSource).toBe('ai_catalyst_momentum')
    expect(detail.version.backtestable).toBe(false)
  })

  it('exposes AI decisions and status through HTTP routes', async () => {
    const app = await createFastifyApp()
    await registerRoutes(app)

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/ai/strategies/tmpl_ai_catalyst_momentum/status'
    })
    expect(statusRes.statusCode).toBe(200)
    const statusData = JSON.parse(statusRes.payload)
    expect(statusData.success).toBe(true)
    expect(statusData.data.templateId).toBe('tmpl_ai_catalyst_momentum')
    expect(statusData.data.capitalAllocated).toBe(10000)

    const decisionsRes = await app.inject({
      method: 'GET',
      url: '/api/ai/strategies/tmpl_ai_catalyst_momentum/decisions'
    })
    expect(decisionsRes.statusCode).toBe(200)
    const decisionsData = JSON.parse(decisionsRes.payload)
    expect(decisionsData.success).toBe(true)
    expect(decisionsData.data.templateId).toBe('tmpl_ai_catalyst_momentum')
    expect(Array.isArray(decisionsData.data.decisions)).toBe(true)

    await app.close()
  })
})
