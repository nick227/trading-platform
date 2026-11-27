import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import prisma from '../../src/loaders/prisma.js'
import authRoutes from '../../src/routes/auth.js'
import accountRoutes from '../../src/routes/account.js'
import portfoliosRoutes from '../../src/routes/portfolios.js'
import aiStrategyRoutes from '../../src/routes/aiStrategyRoutes.js'
import {
  runPersonalAiTraderCycle,
  settlePersonalAiTraderPaperOrders
} from '../../src/services/ai/personalAiTraderService.js'
import { valuePortfolio } from '../../src/services/portfolioValuationService.js'
import { claimNextExecution, isSimulatedOnlyAiExecution } from '../../../worker/src/queues/orderWorker.js'
import {
  buildPortfolioNarrativeSummary,
  buildSinceLastCheckedBriefing
} from '../../../app/src/ui/narrativeSummaries.js'

/**
 * Generates 65 NYSE trading days of deterministic OHLCV bars up through `endSession`
 * so `screenAiStockUniverse` (requiring >=51 bars) qualifies candidates cleanly.
 */
function generateDailyBars(symbol, endSession = '2026-11-25', finalClose = 140) {
  const bars = []
  let cursor = Date.parse(`${endSession}T12:00:00Z`)
  const dates = []
  while (dates.length < 65) {
    const d = new Date(cursor)
    const dow = d.getUTCDay()
    const iso = d.toISOString().slice(0, 10)
    if (dow !== 0 && dow !== 6 && iso !== '2026-11-26') {
      dates.unshift(iso)
    }
    cursor -= 86_400_000
  }
  const startPrice = symbol === 'NVDA' ? finalClose * 0.72 : finalClose * 0.94
  dates.forEach((dateStr, idx) => {
    const progress = idx / (dates.length - 1)
    const close = Number((startPrice + (finalClose - startPrice) * progress).toFixed(2))
    const open = Number((close * 0.995).toFixed(2))
    const high = Number((close * 1.01).toFixed(2))
    const low = Number((close * 0.99).toFixed(2))
    bars.push([dateStr, open, high, low, close, 4_500_000])
  })
  return { symbol, bars }
}

describe('Complete Registration-to-Simulated-Portfolio Journey (MR 1–4 E2E)', () => {
  let app
  let createdUserId = null

  beforeAll(async () => {
    app = Fastify()
    await app.register(cookie)
    await app.register(jwt, {
      secret: process.env.JWT_SECRET || 'test-e2e-journey-jwt-secret',
      cookie: { cookieName: 'access_token', signed: false }
    })
    await app.register(authRoutes, { prefix: '/api/auth' })
    await app.register(accountRoutes, { prefix: '/api/account' })
    await app.register(portfoliosRoutes, { prefix: '/api/portfolios' })
    await app.register(aiStrategyRoutes, { prefix: '/api/ai' })
    await app.ready()
  })

  afterAll(async () => {
    if (createdUserId) {
      const botId = `bot_personal_ai_${createdUserId}`
      await prisma.executionAudit.deleteMany({ where: { userId: createdUserId } }).catch(() => {})
      await prisma.botEvent.deleteMany({ where: { botId } }).catch(() => {})
      await prisma.aiUsageCall.deleteMany({ where: { botId } }).catch(() => {})
      await prisma.aiUsageBucket.deleteMany({ where: { id: { startsWith: `user_trader:${createdUserId}:` } } }).catch(() => {})
      await prisma.copilotProposal.deleteMany({ where: { userId: createdUserId } }).catch(() => {})
      await prisma.execution.deleteMany({ where: { userId: createdUserId } }).catch(() => {})
      await prisma.bot.deleteMany({ where: { userId: createdUserId } }).catch(() => {})
      await prisma.defaultPaperPortfolio.deleteMany({ where: { userId: createdUserId } }).catch(() => {})
      await prisma.portfolio.deleteMany({ where: { userId: createdUserId } }).catch(() => {})
      await prisma.subscription.deleteMany({ where: { userId: createdUserId } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: createdUserId } }).catch(() => {})
    }
    await app?.close()
  })

  it('validates registration -> $10k paper portfolio -> structured AI setup -> exchange-calendar Copilot review -> simulated fill -> narrative briefing', async () => {
    // 1. Register a brand-new user without any external brokerage credentials
    const email = `e2e_journey_${Date.now()}@example.test`
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        password: 'JourneyPassword!123',
        fullName: 'End-to-End Lazy Investor'
      }
    })
    expect(registerRes.statusCode).toBe(201)
    const registered = registerRes.json()
    createdUserId = registered.id
    expect(registered.defaultPaperPortfolioId).toBe(`prt_paper_${createdUserId}`)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'JourneyPassword!123' }
    })
    expect(loginRes.statusCode).toBe(200)
    const token = app.jwt.sign({ sub: createdUserId })
    const headers = { authorization: `Bearer ${token}` }

    // Verify immediate $10,000 simulated paper status and default portfolio uniqueness
    const initialVal = await valuePortfolio(createdUserId, {
      prismaClient: prisma,
      config: { enabled: false },
      engine: { getSessionClose: async () => null },
      fetchBrokerAccount: async () => null
    })
    expect(initialVal.source).toBe('simulated_paper')
    expect(initialVal.simulated).toBe(true)
    expect(initialVal.cash).toBe(10000)
    expect(initialVal.equity).toBe(10000)

    // 2. Configure structured Personal AI Trader (zero freeform text)
    const setupRes = await app.inject({
      method: 'PUT',
      url: '/api/ai/personal-trader',
      headers,
      payload: {
        riskProfile: 'balanced',
        sectors: ['Technology'],
        approvalMode: 'paper_veto_1s',
        enabled: true
      }
    })
    expect(setupRes.statusCode).toBe(200)
    expect(setupRes.json().data.configured).toBe(true)

    // 3. Run governed Personal AI Trader daily research cycle on Wed 2026-11-25 post-close
    const mockEngine = {
      getDailyBars: async (sym) => {
        const priceMap = { SPY: 590, AAPL: 225, MSFT: 420, NVDA: 140 }
        return generateDailyBars(sym, '2026-11-25', priceMap[sym] || 120)
      },
      getSessionClose: async (sym, session) => {
        if (session === '2026-11-27') {
          return { symbol: sym, session: '2026-11-27', open: 142, close: 145 }
        }
        return { symbol: sym, session: session || '2026-11-28', open: 145, close: 148 }
      }
    }

    let callIdx = 0
    const mockProvider = {
      completeStructured: async ({ userPrompt }) => {
        callIdx += 1
        if (callIdx === 1) {
          return {
            model: 'gpt-4o-mini',
            usage: { prompt_tokens: 900, completion_tokens: 180 },
            structured: {
              focus: 'Verify NVDA relative strength and SEC filings',
              requests: [{ toolId: 'get_stock_metrics', args: { symbol: 'NVDA' } }]
            }
          }
        }
        return {
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 1200, completion_tokens: 320 },
          structured: {
            asOfSession: '2026-11-25',
            marketSummary: 'Constructive Technology leadership into holiday-shortened week.',
            decisions: [
              {
                symbol: 'NVDA',
                action: 'BUY',
                confidence: 0.84,
                targetAllocationPct: 0.15,
                thesis: 'NVDA leads Technology breadth with accelerating data-center demand.',
                evidence: ['20d relative strength +6.5% vs SPY', 'SEC 10-Q filing confirms margin expansion'],
                risks: ['Semiconductor capex cyclicality'],
                exitRule: { stopLossPct: 4, takeProfitPct: 8 }
              }
            ]
          }
        }
      }
    }

    const cycleResult = await runPersonalAiTraderCycle(createdUserId, {
      env: {
        ENABLE_USER_AI_TRADERS: 'true',
        ENABLE_AI_PAID_CALLS: 'true',
        AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS: '500',
        AI_USER_TRADER_MONTHLY_BUDGET_CENTS: '100',
        AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL: '5'
      },
      now: new Date('2026-11-25T21:50:00.000Z'),
      session: '2026-11-25',
      prismaClient: prisma,
      engine: mockEngine,
      provider: mockProvider,
      externalEvidenceRegistry: {
        assemble: async () => ({ items: [], bySource: {}, errors: [] })
      }
    })

    expect(cycleResult.ok).toBe(true)
    expect(cycleResult.proposals).toHaveLength(1)
    const proposal = cycleResult.proposals[0]
    expect(proposal.symbol).toBe('NVDA')
    expect(proposal.status).toBe('pending_veto')
    // Thanksgiving skipped -> Black Friday Nov 27 1:00 PM ET early close (18:00Z)
    expect(proposal.deadlineSession).toBe('2026-11-27')
    expect(proposal.deadlineAt).toBe('2026-11-27T18:00:00.000Z')
    expect(proposal.deadlineLabel).toContain('1:00 PM ET (NYSE early close)')

    // Lifecycle endpoint reflects pending proposal review
    const traderPendingRes = await app.inject({
      method: 'GET',
      url: '/api/ai/personal-trader',
      headers
    })
    expect(traderPendingRes.json().data.lifecycle.state).toBe('proposal_pending_review')

    // 4. Explicit approval over HTTP queues 1 simulated paper order and blocks live orderWorker
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/ai/copilot-proposals/${proposal.id}/approve`,
      headers,
      payload: {}
    })
    expect(approveRes.statusCode).toBe(200)
    const approvedData = approveRes.json().data
    expect(approvedData.proposal.status).toBe('approved')
    expect(isSimulatedOnlyAiExecution(approvedData.execution)).toBe(true)

    // Ensure orderWorker's live-brokerage claim loop ignores AI simulated executions
    const claimedByLiveWorker = await claimNextExecution()
    expect(claimedByLiveWorker?.id).not.toBe(approvedData.execution.id)

    // 5. Settle simulated fill on Black Friday session 2026-11-27 (@ open $142 x 10 = $1,420)
    const settleRes = await settlePersonalAiTraderPaperOrders(createdUserId, {
      currentSession: '2026-11-27',
      now: () => new Date('2026-11-27T18:30:00.000Z'),
      prismaClient: prisma,
      engine: mockEngine
    })
    expect(settleRes.ok).toBe(true)
    expect(settleRes.filledCount).toBe(1)

    // Proposal audit state transitions deterministically to `executed`
    const proposalsAfterFill = await app.inject({
      method: 'GET',
      url: '/api/ai/copilot-proposals',
      headers
    })
    const resolvedProposal = proposalsAfterFill.json().data.recentResolved.find((p) => p.id === proposal.id)
    expect(resolvedProposal.status).toBe('executed')

    // Portfolio valuation marks 10 NVDA @ $148 close ($8,580 cash + $1,480 MV = $10,060, +$60 P&L)
    const postFillVal = await valuePortfolio(createdUserId, {
      prismaClient: prisma,
      config: { enabled: false },
      engine: mockEngine,
      fetchBrokerAccount: async () => null
    })
    expect(postFillVal.source).toBe('simulated_paper')
    expect(postFillVal.simulated).toBe(true)
    expect(postFillVal.cash).toBe(8580)
    expect(postFillVal.marketValue).toBe(1480)
    expect(postFillVal.equity).toBe(10060)
    expect(postFillVal.totalPnl).toBe(60)
    expect(postFillVal.positions).toHaveLength(1)
    expect(postFillVal.positions[0].symbol).toBe('NVDA')

    // Deterministic narrative & "Since you last checked" summaries require zero LLM calls
    const narrative = buildPortfolioNarrativeSummary({
      valuation: postFillVal,
      bots: [{ id: `bot_personal_ai_${createdUserId}`, running: true, status: 'running' }],
      actionableProposalsCount: 0
    })
    expect(narrative).toContain('$10,060.00')
    expect(narrative).toContain('+$60.00')
    expect(narrative).toContain('1 open holding')

    const deltaBriefing = buildSinceLastCheckedBriefing(postFillVal, {
      equity: initialVal.equity,
      fillCount: initialVal.fillCount
    })
    expect(deltaBriefing).toBe('Portfolio value moved +$60.00 since your last visit with 1 new simulated fill recorded.')
  })
})
