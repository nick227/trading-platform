import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../../src/loaders/prisma.js'
import { configurePersonalAiTrader } from '../../src/services/ai/personalAiTraderService.js'
import {
  approveCopilotProposal,
  cancelCopilotProposal,
  computeProposalExchangeSchedule,
  createCopilotProposal,
  reconcileDueCopilotProposals
} from '../../src/services/ai/copilotProposalService.js'

describe('MR 3 — Exchange-Calendar Copilot Proposals & Deterministic Lifecycle', () => {
  const createdUserIds = []

  afterAll(async () => {
    for (const uid of createdUserIds) {
      await prisma.botEvent.deleteMany({ where: { botId: `bot_personal_ai_${uid}` } }).catch(() => {})
      await prisma.copilotProposal.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.execution.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.bot.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.defaultPaperPortfolio.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.portfolio.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.subscription.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {})
    }
  })

  it('computes NYSE exchange-calendar deadlines accurately across holidays, weekends, early closes, and DST', () => {
    // Wed Nov 25, 2026 -> skips Thanksgiving (Nov 26) -> Black Friday Nov 27, 2026 1:00 PM EST (18:00Z)
    const thanksgivingSched = computeProposalExchangeSchedule('2026-11-25')
    expect(thanksgivingSched.deadlineSession).toBe('2026-11-27')
    expect(thanksgivingSched.isEarlyCloseDeadline).toBe(true)
    expect(thanksgivingSched.nyCloseTimeLabel).toBe('1:00 PM ET')
    expect(thanksgivingSched.deadlineAt.toISOString()).toBe('2026-11-27T18:00:00.000Z')
    expect(thanksgivingSched.postDeadlineExecutionSession).toBe('2026-11-30')

    // Thu Jul 2, 2026 -> skips Jul 3 observed Independence Day + weekend -> Mon Jul 6, 2026 4:00 PM EDT (20:00Z)
    const summerSched = computeProposalExchangeSchedule('2026-07-02')
    expect(summerSched.deadlineSession).toBe('2026-07-06')
    expect(summerSched.isEarlyCloseDeadline).toBe(false)
    expect(summerSched.nyCloseTimeLabel).toBe('4:00 PM ET')
    expect(summerSched.deadlineAt.toISOString()).toBe('2026-07-06T20:00:00.000Z')
  })

  it('prevents duplicate Execution records under concurrent approvals via atomic CAS and unique keys', async () => {
    const user = await prisma.user.create({
      data: {
        email: `mr3_cas_${Date.now()}@example.test`,
        passwordHash: '$test$',
        fullName: 'CAS Tester'
      }
    })
    createdUserIds.push(user.id)

    const traderState = await configurePersonalAiTrader(user.id, {
      riskProfile: 'balanced',
      sectors: ['Technology'],
      approvalMode: 'require_approval',
      enabled: true
    })
    const bot = await prisma.bot.findUnique({ where: { id: traderState.bot.id } })
    const portfolio = await prisma.portfolio.findUnique({ where: { id: traderState.portfolio.id } })

    const proposal = await createCopilotProposal({
      userId: user.id,
      bot,
      portfolio,
      signalSession: '2026-11-25',
      intent: {
        symbol: 'NVDA',
        action: 'BUY',
        confidence: 0.82,
        targetAllocationPct: 0.15,
        thesis: 'Strong AI data-center demand backed by verified 10-Q disclosure.',
        evidence: ['SEC 10-Q revenue acceleration'],
        risks: ['Customer concentration']
      },
      referencePrice: 140,
      approvalMode: 'require_approval'
    })

    expect(proposal.status).toBe('pending_approval')
    expect(proposal.deadlineSession).toBe('2026-11-27')
    expect(proposal.deadlineLabel).toContain('1:00 PM ET (NYSE early close)')

    const beforeDeadline = () => new Date('2026-11-27T15:00:00.000Z')
    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        approveCopilotProposal(user.id, proposal.id, { now: beforeDeadline })
      )
    )

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled')
    const rejected = outcomes.filter((o) => o.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(5)
    expect(fulfilled[0].value.proposal.status).toBe('approved')

    const executions = await prisma.execution.findMany({ where: { botId: bot.id } })
    expect(executions).toHaveLength(1)
    expect(executions[0].ticker).toBe('NVDA')
    expect(executions[0].quantity).toBe(10) // floor(1500 / 140) = 10 shares
  })

  it('maintains distinct auditable states for cancellation, expiration, paper veto auto-queue, fill sync, and non-paper block', async () => {
    const user = await prisma.user.create({
      data: {
        email: `mr3_states_${Date.now()}@example.test`,
        passwordHash: '$test$',
        fullName: 'Lifecycle Tester'
      }
    })
    createdUserIds.push(user.id)

    const traderState = await configurePersonalAiTrader(user.id, {
      riskProfile: 'growth',
      sectors: ['Technology', 'Healthcare'],
      approvalMode: 'paper_veto_1s',
      enabled: true
    })
    const bot = await prisma.bot.findUnique({ where: { id: traderState.bot.id } })
    const portfolio = await prisma.portfolio.findUnique({ where: { id: traderState.portfolio.id } })

    // 1. User cancellation (`pending_veto` -> `cancelled`)
    const pCancel = await createCopilotProposal({
      userId: user.id,
      bot,
      portfolio,
      signalSession: '2026-11-23',
      intent: { symbol: 'AAPL', action: 'BUY', confidence: 0.78, targetAllocationPct: 0.15, thesis: 'AAPL setup' },
      referencePrice: 220,
      approvalMode: 'paper_veto_1s'
    })
    const cancelled = await cancelCopilotProposal(user.id, pCancel.id, {
      now: () => new Date('2026-11-24T15:00:00Z'),
      reason: 'user_vetoed'
    })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.statusReason).toBe('user_vetoed')

    // 2. `pending_approval` past deadline -> `expired`
    const pExpire = await createCopilotProposal({
      userId: user.id,
      bot,
      portfolio,
      signalSession: '2026-11-23',
      intent: { symbol: 'MSFT', action: 'BUY', confidence: 0.80, targetAllocationPct: 0.15, thesis: 'MSFT setup' },
      referencePrice: 410,
      approvalMode: 'require_approval'
    })

    // 3. `pending_veto` with >3% price drift -> `expired` (`price_drift_exceeded`)
    const pDrift = await createCopilotProposal({
      userId: user.id,
      bot,
      portfolio,
      signalSession: '2026-11-24',
      intent: { symbol: 'GOOGL', action: 'BUY', confidence: 0.80, targetAllocationPct: 0.15, thesis: 'GOOGL setup' },
      referencePrice: 170,
      approvalMode: 'paper_veto_1s'
    })

    // 4. `pending_veto` in paper mode within drift -> `auto_queued_paper` -> `executed`
    const pAuto = await createCopilotProposal({
      userId: user.id,
      bot,
      portfolio,
      signalSession: '2026-11-25',
      intent: { symbol: 'LLY', action: 'BUY', confidence: 0.85, targetAllocationPct: 0.20, thesis: 'LLY setup' },
      referencePrice: 800,
      approvalMode: 'paper_veto_1s'
    })

    // 5. Tampered non-paper `pending_veto` -> MUST NEVER auto-queue (`non_paper_silent_auth_forbidden`)
    const pNonPaper = await createCopilotProposal({
      userId: user.id,
      bot,
      portfolio,
      signalSession: '2026-11-25',
      intent: { symbol: 'NVDA', action: 'BUY', confidence: 0.85, targetAllocationPct: 0.15, thesis: 'Tamper check' },
      referencePrice: 140,
      approvalMode: 'paper_veto_1s'
    })
    await prisma.copilotProposal.update({
      where: { id: pNonPaper.id },
      data: { mode: 'live' }
    })

    const postFridayDeadline = () => new Date('2026-11-27T18:05:00.000Z')
    await reconcileDueCopilotProposals({
      userId: user.id,
      now: postFridayDeadline,
      priceResolver: async (sym) => {
        if (sym === 'GOOGL') return 185 // +8.8% drift > 3% limit
        if (sym === 'LLY') return 805   // +0.6% drift <= 3% limit
        return null
      }
    })

    const reloadedExpire = await prisma.copilotProposal.findUnique({ where: { id: pExpire.id } })
    const reloadedDrift = await prisma.copilotProposal.findUnique({ where: { id: pDrift.id } })
    const reloadedAuto = await prisma.copilotProposal.findUnique({ where: { id: pAuto.id } })
    const reloadedNonPaper = await prisma.copilotProposal.findUnique({ where: { id: pNonPaper.id } })

    expect(reloadedExpire.status).toBe('expired')
    expect(reloadedExpire.statusReason).toBe('approval_deadline_expired')
    expect(reloadedDrift.status).toBe('expired')
    expect(reloadedDrift.statusReason).toMatch(/^price_drift_exceeded/)
    expect(reloadedNonPaper.status).toBe('expired')
    expect(reloadedNonPaper.statusReason).toBe('non_paper_silent_auth_forbidden')
    expect(reloadedNonPaper.executionId).toBeNull()

    expect(reloadedAuto.status).toBe('auto_queued_paper')
    expect(reloadedAuto.targetExecutionSession).toBe('2026-11-30')
    expect(reloadedAuto.executionId).toBeTruthy()

    // Simulate fill on `reloadedAuto.executionId` and verify transition to `executed`
    await prisma.execution.update({
      where: { id: reloadedAuto.executionId },
      data: {
        status: 'filled',
        filledQuantity: 2,
        filledPrice: 805,
        filledAt: new Date('2026-11-30T21:00:00.000Z'),
        brokerOrderId: 'simdaily_2026-11-30_lly'
      }
    })

    await reconcileDueCopilotProposals({
      userId: user.id,
      now: () => new Date('2026-11-30T21:05:00.000Z')
    })

    const reloadedExecuted = await prisma.copilotProposal.findUnique({ where: { id: pAuto.id } })
    expect(reloadedExecuted.status).toBe('executed')
    expect(reloadedExecuted.statusReason).toBe('simulated_fill_completed')
  })
})
