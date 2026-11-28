/**
 * Exchange-Calendar Copilot Proposal Service (MR 3).
 *
 * Key Guarantees:
 * 1. Exchange-calendar deadlines: Never conflates 24 wall-clock hours, 1 trading session,
 *    and next session close. Deadlines are anchored strictly to the next NYSE trading
 *    session's official close (1:00 PM ET on scheduled early-close sessions such as Black
 *    Friday / July 3 / Christmas Eve; 4:00 PM ET on standard sessions), skipping weekends
 *    and US exchange holidays.
 * 2. Separate auditable states: `pending_approval`, `pending_veto`, `approved`,
 *    `auto_queued_paper`, `cancelled`, `expired`, and `executed`.
 * 3. Atomic compare-and-swap transitions + unique `executionId` + unique `clientOrderId`
 *    under the portfolio row lock prevent duplicate `Execution` records under concurrency.
 * 4. Silence is NEVER authorization for real-money transactions: `pending_veto` auto-queue
 *    is strictly restricted to `mode === 'paper'`.
 */
import { randomUUID } from 'node:crypto'
import prisma from '../../loaders/prisma.js'
import { isExchangeEarlyClose, isExchangeTradingDay } from '../../utils/marketCalendar.js'
import { nextStockTraderSession } from './stockTraderTradingSession.js'
import { evaluateStockTraderPaperProposal } from './stockTraderRiskPolicy.js'
import {
  AUTHORIZATION_MODES,
  buildAuthorizationEnvelope,
  buildMarketObservation,
  evaluateAndReserveTradeIntentTx,
  EXECUTION_TIMINGS
} from '../../policy/centralPolicyEngine.js'
import { MARKET_LATENCY_CLASSES } from '../../execution/providers/ExecutionProvider.js'
import {
  STOCK_TRADER_ACTIVE_ORDER_STATUSES,
  calculateStockTraderSessionRealizedPnl,
  reconcileStockTraderFills
} from './stockTraderAccounting.js'
import { readEmergencyStop } from '../emergencyStopService.js'

export const COPILOT_PENDING_STATUSES = Object.freeze(['pending_approval', 'pending_veto'])
export const COPILOT_MAX_VETO_DRIFT_PCT = 0.03 // 3% max price drift for un-vetoed paper auto-queue

export class CopilotProposalError extends Error {
  constructor(message, code = 'COPILOT_PROPOSAL_ERROR', status = 400) {
    super(message)
    this.name = 'CopilotProposalError'
    this.code = code
    this.status = status
  }
}

/**
 * Resolves the exact UTC timestamp of the official NYSE market close on `sessionStr`
 * (13:00 America/New_York on early-close sessions, 16:00 America/New_York on regular sessions),
 * accounting accurately for EST (-05:00) vs EDT (-04:00).
 */
export function exchangeSessionCloseUtc(sessionStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionStr ?? '')) || !isExchangeTradingDay(sessionStr)) {
    throw new CopilotProposalError(`Valid NYSE trading session required, received: ${sessionStr}`, 'INVALID_EXCHANGE_SESSION')
  }
  const earlyClose = isExchangeEarlyClose(sessionStr)
  const nyCloseHour = earlyClose ? 13 : 16

  // Probe America/New_York offset on that calendar date at 17:00Z (noon/1pm ET, safely clear of 2am DST transitions)
  const probe = new Date(`${sessionStr}T17:00:00.000Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset'
  }).formatToParts(probe)
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5'
  const match = tzPart.match(/GMT([+-]\d{1,2})/)
  const offsetHours = match ? Number(match[1]) : -5 // e.g. -5 for EST, -4 for EDT
  const utcHour = nyCloseHour - offsetHours

  const deadlineAt = new Date(`${sessionStr}T${String(utcHour).padStart(2, '0')}:00:00.000Z`)
  return {
    session: sessionStr,
    isEarlyClose: earlyClose,
    nyCloseTimeLabel: earlyClose ? '1:00 PM ET' : '4:00 PM ET',
    deadlineAt
  }
}

/**
 * Computes the NYSE exchange-calendar deadline schedule for a proposal generated
 * from completed session `signalSession`.
 */
export function computeProposalExchangeSchedule(signalSession) {
  const deadlineSession = nextStockTraderSession(signalSession)
  const closeInfo = exchangeSessionCloseUtc(deadlineSession)
  const postDeadlineExecutionSession = nextStockTraderSession(deadlineSession)

  return {
    signalSession,
    deadlineSession,
    deadlineAt: closeInfo.deadlineAt,
    isEarlyCloseDeadline: closeInfo.isEarlyClose,
    nyCloseTimeLabel: closeInfo.nyCloseTimeLabel,
    postDeadlineExecutionSession
  }
}

export function formatProposalDeadlineLabel(proposal) {
  if (!proposal?.deadlineAt) return '—'
  const dt = proposal.deadlineAt instanceof Date ? proposal.deadlineAt : new Date(proposal.deadlineAt)
  if (Number.isNaN(dt.getTime())) return '—'
  const formatted = dt.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `${formatted} ET${proposal.isEarlyCloseDeadline ? ' (NYSE early close)' : ' (NYSE close)'}`
}

export function enrichProposalForClient(proposal) {
  if (!proposal) return null
  return {
    ...proposal,
    deadlineAt: proposal.deadlineAt instanceof Date ? proposal.deadlineAt.toISOString() : proposal.deadlineAt,
    decidedAt: proposal.decidedAt instanceof Date ? proposal.decidedAt.toISOString() : proposal.decidedAt,
    executedAt: proposal.executedAt instanceof Date ? proposal.executedAt.toISOString() : proposal.executedAt,
    deadlineLabel: formatProposalDeadlineLabel(proposal)
  }
}

/**
 * Creates an auditable simulated Copilot proposal for a user's paper portfolio.
 * Refuses non-paper modes (`mode !== 'paper'`).
 */
export async function createCopilotProposal({
  userId,
  bot,
  portfolio,
  signalSession,
  intent,
  referencePrice,
  approvalMode = 'paper_veto_1s',
  prismaClient = prisma
}) {
  if (!bot || bot.config?.mode !== 'paper' || portfolio?.id !== bot.portfolioId || bot.userId !== userId) {
    throw new CopilotProposalError(
      'Copilot proposals require a user-owned paper bot and matching paper portfolio',
      'NON_PAPER_BOT_FORBIDDEN',
      403
    )
  }
  if (!['paper_veto_1s', 'require_approval'].includes(approvalMode)) {
    throw new CopilotProposalError(`Unsupported proposal approvalMode: ${approvalMode}`, 'INVALID_APPROVAL_MODE')
  }
  const symbol = String(intent?.symbol ?? '').trim().toUpperCase()
  const action = String(intent?.action ?? '').trim().toUpperCase()
  const price = Number(referencePrice)
  if (!symbol || !['BUY', 'SELL'].includes(action) || !Number.isFinite(price) || price <= 0) {
    throw new CopilotProposalError('Valid symbol, BUY/SELL action, and positive referencePrice required')
  }

  const fills = await prismaClient.execution.findMany({
    where: { botId: bot.id, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } }
  })
  const activeOrders = await prismaClient.execution.findMany({
    where: { botId: bot.id, status: { in: [...STOCK_TRADER_ACTIVE_ORDER_STATUSES] } }
  })
  const portfolioSnap = reconcileStockTraderFills({
    fills,
    allocatedCapital: Number(bot.config?.allocatedAmount) || 10_000,
    asOfSession: signalSession,
    quotes: { [symbol]: price }
  })
  const sessionRealizedPnl = calculateStockTraderSessionRealizedPnl({
    fills,
    session: signalSession
  })
  const riskPlan = evaluateStockTraderPaperProposal({
    intent: {
      symbol,
      action,
      confidence: Number(intent.confidence ?? 0.75),
      targetAllocationPct: Number(intent.targetAllocationPct ?? bot.config?.execution?.maxPositionPct ?? 0.15)
    },
    price,
    portfolio: portfolioSnap,
    activeOrders,
    executionLimits: bot.config?.execution || { maxPositionPct: 0.15, maxOrderNotional: 1500 },
    sessionRealizedPnl
  })
  if (!riskPlan.allowed) {
    throw new CopilotProposalError(
      `Proposal rejected by deterministic risk policy: ${riskPlan.reason}`,
      'RISK_POLICY_REJECTED'
    )
  }

  const schedule = computeProposalExchangeSchedule(signalSession)
  const status = approvalMode === 'paper_veto_1s' ? 'pending_veto' : 'pending_approval'
  const id = `cprop_${bot.id}_${signalSession.replace(/-/g, '')}_${symbol}`.slice(0, 191)

  const created = await prismaClient.copilotProposal.upsert({
    where: {
      botId_signalSession_symbol: {
        botId: bot.id,
        signalSession,
        symbol
      }
    },
    update: {},
    create: {
      id,
      userId: String(userId),
      botId: bot.id,
      portfolioId: portfolio.id,
      signalSession,
      symbol,
      action,
      quantity: riskPlan.quantity,
      referencePrice: price,
      estimatedNotional: Math.round(riskPlan.notional * 100) / 100,
      targetAllocationPct: intent.targetAllocationPct ?? null,
      confidence: intent.confidence ?? null,
      thesis: String(intent.thesis || `${action} ${symbol} based on daily close research.`).slice(0, 4000),
      evidence: Array.isArray(intent.evidence) ? intent.evidence : [],
      risks: Array.isArray(intent.risks) ? intent.risks : [],
      exitRule: intent.exitRule ?? null,
      approvalMode,
      mode: 'paper',
      status,
      deadlineSession: schedule.deadlineSession,
      deadlineAt: schedule.deadlineAt,
      isEarlyCloseDeadline: schedule.isEarlyCloseDeadline,
      targetExecutionSession: schedule.deadlineSession
    }
  })

  return enrichProposalForClient(created)
}

/**
 * Internal helper: atomically transitions a pending proposal to `nextStatus` (`approved` or `auto_queued_paper`)
 * and creates exactly ONE paper `Execution` row inside a single DB transaction under the portfolio lock.
 */
async function admitProposalPaperExecutionTx(tx, {
  proposal,
  nextStatus,
  executionPrice,
  targetSession,
  now,
  statusReason
}) {
  if (proposal.mode !== 'paper') {
    throw new CopilotProposalError('Non-paper proposal execution is forbidden', 'NON_PAPER_EXECUTION_FORBIDDEN', 403)
  }

  // Obtain write lock on portfolio to serialize competing admissions
  await tx.portfolio.update({
    where: { id: proposal.portfolioId },
    data: { updatedAt: now }
  })

  const actor = await tx.user.findUnique({
    where: { id: proposal.userId },
    select: { riskSettings: true }
  })
  if (!actor || readEmergencyStop(actor.riskSettings).active) {
    return { admitted: false, reason: 'emergency_stop_active' }
  }

  const bot = await tx.bot.findUnique({ where: { id: proposal.botId } })
  if (!bot || bot.deletedAt || bot.config?.mode !== 'paper') {
    return { admitted: false, reason: 'bot_inactive_or_invalid' }
  }

  const clientOrderId = `co_copilot_${proposal.id}`.slice(0, 191)
  const activeIntentKey = `intent_copilot_${proposal.id}`.slice(0, 191)
  const existingExec = await tx.execution.findFirst({
    where: { OR: [{ clientOrderId }, { activeIntentKey }] }
  })
  if (existingExec) {
    return { admitted: false, reason: 'duplicate_execution_prevented', existingExecutionId: existingExec.id }
  }

  const fills = await tx.execution.findMany({
    where: { botId: bot.id, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } }
  })
  const activeOrders = await tx.execution.findMany({
    where: { botId: bot.id, status: { in: [...STOCK_TRADER_ACTIVE_ORDER_STATUSES] } }
  })
  const freshPortfolio = reconcileStockTraderFills({
    fills,
    allocatedCapital: Number(bot.config?.allocatedAmount) || 10_000,
    asOfSession: proposal.signalSession,
    quotes: { [proposal.symbol]: executionPrice }
  })
  const sessionRealizedPnl = calculateStockTraderSessionRealizedPnl({
    fills,
    session: proposal.signalSession
  })
  const riskPlan = evaluateStockTraderPaperProposal({
    intent: {
      symbol: proposal.symbol,
      action: proposal.action,
      confidence: Number(proposal.confidence ?? 0.75),
      targetAllocationPct: Number(proposal.targetAllocationPct ?? bot.config?.execution?.maxPositionPct ?? 0.15)
    },
    price: executionPrice,
    portfolio: freshPortfolio,
    activeOrders,
    executionLimits: bot.config?.execution || { maxPositionPct: 0.15, maxOrderNotional: 1500 },
    sessionRealizedPnl
  })
  if (!riskPlan.allowed) {
    return { admitted: false, reason: `risk_limit_blocked:${riskPlan.reason}` }
  }

  const executionId = `exec_cprop_${randomUUID().replace(/-/g, '').slice(0, 16)}`

  // Central Policy, Authorization Provenance & Atomic Reservation Gate (P4)
  const authMode = nextStatus === 'approved'
    ? AUTHORIZATION_MODES.USER_EXPLICIT_PROPOSAL_APPROVAL
    : AUTHORIZATION_MODES.PAPER_VETO_SIM_ONLY
  const policyRes = await evaluateAndReserveTradeIntentTx(tx, {
    executionId,
    userId: proposal.userId,
    portfolioId: proposal.portfolioId,
    botId: proposal.botId,
    proposalId: proposal.id,
    symbol: proposal.symbol,
    side: proposal.action.toLowerCase(),
    quantity: riskPlan.quantity,
    referencePrice: executionPrice,
    executionTiming: EXECUTION_TIMINGS.NEXT_OPEN,
    authorization: buildAuthorizationEnvelope({
      authorizationMode: authMode,
      actorUserId: proposal.userId,
      botId: proposal.botId,
      proposalId: proposal.id,
      mandatePayload: { approvalMode: proposal.approvalMode, signalSession: proposal.signalSession },
      authorizedAt: now
    }),
    marketObservation: buildMarketObservation({
      symbol: proposal.symbol,
      price: executionPrice,
      observedAt: now,
      asOfSession: proposal.signalSession,
      source: 'alpha-engine',
      latencyClass: MARKET_LATENCY_CLASSES.SESSION_CLOSE
    }),
    now
  })
  if (!policyRes.allowed) {
    return { admitted: false, reason: `central_policy_blocked:${policyRes.reason}` }
  }

  // Atomic compare-and-swap on CopilotProposal BEFORE creating Execution
  const cas = await tx.copilotProposal.updateMany({
    where: {
      id: proposal.id,
      userId: proposal.userId,
      status: { in: [...COPILOT_PENDING_STATUSES] },
      revision: proposal.revision,
      executionId: null
    },
    data: {
      status: nextStatus,
      quantity: riskPlan.quantity,
      estimatedNotional: Math.round(riskPlan.notional * 100) / 100,
      targetExecutionSession: targetSession,
      executionId,
      statusReason,
      decidedAt: now,
      revision: { increment: 1 }
    }
  })

  if (cas.count !== 1) {
    return { admitted: false, reason: 'concurrent_state_transition' }
  }

  const execution = await tx.execution.create({
    data: {
      id: executionId,
      userId: proposal.userId,
      portfolioId: proposal.portfolioId,
      botId: proposal.botId,
      ticker: proposal.symbol,
      direction: proposal.action.toLowerCase(),
      quantity: riskPlan.quantity,
      price: executionPrice,
      origin: 'bot',
      status: 'queued',
      simSession: targetSession,
      scheduledFor: new Date(`${targetSession}T14:30:00.000Z`),
      clientOrderId,
      activeIntentKey,
      commission: 0,
      fees: 0,
      sourceType: 'ML_SIGNAL',
      sourceId: proposal.id
    }
  })

  await tx.botEvent.create({
    data: {
      id: `evt_cprop_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      botId: proposal.botId,
      portfolioId: proposal.portfolioId,
      executionId: execution.id,
      type: 'execution_created',
      detail: `Copilot paper proposal ${nextStatus}: ${proposal.action} ${riskPlan.quantity} ${proposal.symbol} for ${targetSession}`,
      metadata: {
        proposalId: proposal.id,
        lifecycleTransition: nextStatus,
        statusReason,
        signalSession: proposal.signalSession,
        deadlineSession: proposal.deadlineSession,
        targetExecutionSession: targetSession,
        exitRule: proposal.exitRule || null
      }
    }
  })

  const updated = await tx.copilotProposal.findUnique({ where: { id: proposal.id } })
  return { admitted: true, proposal: updated, execution }
}

/**
 * Explicit user approval of a pending Copilot proposal before its NYSE exchange deadline.
 */
export async function approveCopilotProposal(
  userId,
  proposalId,
  { prismaClient = prisma, now = () => new Date(), latestPrice = null } = {}
) {
  const currentNow = now()
  const current = await prismaClient.copilotProposal.findUnique({ where: { id: String(proposalId) } })
  if (!current || current.userId !== String(userId)) {
    throw new CopilotProposalError('Copilot proposal not found', 'NOT_FOUND', 404)
  }
  if (!COPILOT_PENDING_STATUSES.includes(current.status)) {
    throw new CopilotProposalError(
      `Proposal cannot be approved because its status is '${current.status}'`,
      'PROPOSAL_NOT_PENDING',
      409
    )
  }
  if (currentNow.getTime() >= new Date(current.deadlineAt).getTime()) {
    await prismaClient.copilotProposal.updateMany({
      where: { id: current.id, status: { in: [...COPILOT_PENDING_STATUSES] }, revision: current.revision },
      data: {
        status: 'expired',
        statusReason: 'exchange_deadline_passed',
        decidedAt: currentNow,
        revision: { increment: 1 }
      }
    })
    throw new CopilotProposalError(
      'Proposal deadline has already passed on the NYSE exchange calendar',
      'PROPOSAL_EXPIRED',
      409
    )
  }

  const price = Number.isFinite(Number(latestPrice)) && Number(latestPrice) > 0
    ? Number(latestPrice)
    : current.referencePrice

  const txResult = await prismaClient.$transaction(async (tx) => {
    const fresh = await tx.copilotProposal.findUnique({ where: { id: current.id } })
    if (!fresh || !COPILOT_PENDING_STATUSES.includes(fresh.status)) {
      return { admitted: false, reason: 'concurrent_state_transition' }
    }
    return admitProposalPaperExecutionTx(tx, {
      proposal: fresh,
      nextStatus: 'approved',
      executionPrice: price,
      targetSession: fresh.deadlineSession,
      now: currentNow,
      statusReason: 'explicit_user_approval'
    })
  })

  if (!txResult.admitted) {
    const code = txResult.reason === 'concurrent_state_transition' || txResult.reason === 'duplicate_execution_prevented'
      ? 409
      : 422
    throw new CopilotProposalError(
      `Could not approve proposal: ${txResult.reason}`,
      txResult.reason.toUpperCase(),
      code
    )
  }

  return {
    proposal: enrichProposalForClient(txResult.proposal),
    execution: txResult.execution
  }
}

/**
 * Explicit user cancellation / veto of a pending Copilot proposal before its deadline.
 */
export async function cancelCopilotProposal(
  userId,
  proposalId,
  { prismaClient = prisma, now = () => new Date(), reason = 'cancelled_by_user' } = {}
) {
  const currentNow = now()
  const current = await prismaClient.copilotProposal.findUnique({ where: { id: String(proposalId) } })
  if (!current || current.userId !== String(userId)) {
    throw new CopilotProposalError('Copilot proposal not found', 'NOT_FOUND', 404)
  }
  if (!COPILOT_PENDING_STATUSES.includes(current.status)) {
    throw new CopilotProposalError(
      `Proposal cannot be cancelled because its status is '${current.status}'`,
      'PROPOSAL_NOT_PENDING',
      409
    )
  }

  const cas = await prismaClient.copilotProposal.updateMany({
    where: {
      id: current.id,
      userId: String(userId),
      status: { in: [...COPILOT_PENDING_STATUSES] },
      revision: current.revision
    },
    data: {
      status: 'cancelled',
      statusReason: String(reason).slice(0, 190),
      decidedAt: currentNow,
      revision: { increment: 1 }
    }
  })
  if (cas.count !== 1) {
    throw new CopilotProposalError('Proposal state changed concurrently', 'CONCURRENT_STATE_TRANSITION', 409)
  }

  const updated = await prismaClient.copilotProposal.findUnique({ where: { id: current.id } })
  return enrichProposalForClient(updated)
}

/**
 * Reconciles due proposals on the NYSE exchange calendar AND syncs filled paper executions:
 * - `pending_approval` past `deadlineAt` -> `expired` (`exchange_deadline_passed`).
 * - `pending_veto` past `deadlineAt`:
 *   - NEVER auto-queues if `mode !== 'paper'` -> `expired` (`non_paper_silent_auth_forbidden`).
 *   - Checks price drift (<= 3% if quote available) and deterministic risk limits -> `auto_queued_paper`
 *     (queuing 1 paper `Execution` for `nextStockTraderSession(deadlineSession)`), else `expired`.
 * - `approved` or `auto_queued_paper` whose linked `Execution.status === 'filled'` -> `executed`.
 */
export async function reconcileDueCopilotProposals({
  userId = null,
  prismaClient = prisma,
  now = () => new Date(),
  priceResolver = null
} = {}) {
  const currentNow = now()
  const whereDue = {
    status: { in: [...COPILOT_PENDING_STATUSES] },
    deadlineAt: { lte: currentNow },
    ...(userId ? { userId: String(userId) } : {})
  }

  const dueProposals = await prismaClient.copilotProposal.findMany({
    where: whereDue,
    orderBy: { deadlineAt: 'asc' }
  })

  const transitions = []

  for (const prop of dueProposals) {
    if (prop.status === 'pending_approval') {
      const cas = await prismaClient.copilotProposal.updateMany({
        where: { id: prop.id, status: 'pending_approval', revision: prop.revision },
        data: {
          status: 'expired',
          statusReason: 'approval_deadline_expired',
          decidedAt: currentNow,
          revision: { increment: 1 }
        }
      })
      if (cas.count === 1) transitions.push({ id: prop.id, to: 'expired', reason: 'approval_deadline_expired' })
      continue
    }

    if (prop.status === 'pending_veto') {
      // HARD SAFETY INVARIANT: Silence is NEVER authorization outside simulated paper mode.
      if (prop.mode !== 'paper') {
        const cas = await prismaClient.copilotProposal.updateMany({
          where: { id: prop.id, status: 'pending_veto', revision: prop.revision },
          data: {
            status: 'expired',
            statusReason: 'non_paper_silent_auth_forbidden',
            decidedAt: currentNow,
            revision: { increment: 1 }
          }
        })
        if (cas.count === 1) transitions.push({ id: prop.id, to: 'expired', reason: 'non_paper_silent_auth_forbidden' })
        continue
      }

      let marketPrice = prop.referencePrice
      if (typeof priceResolver === 'function') {
        const resolved = await priceResolver(prop.symbol, prop.deadlineSession).catch(() => null)
        if (Number.isFinite(Number(resolved)) && Number(resolved) > 0) {
          marketPrice = Number(resolved)
        }
      }

      const driftPct = Math.abs(marketPrice - prop.referencePrice) / prop.referencePrice
      if (driftPct > COPILOT_MAX_VETO_DRIFT_PCT) {
        const cas = await prismaClient.copilotProposal.updateMany({
          where: { id: prop.id, status: 'pending_veto', revision: prop.revision },
          data: {
            status: 'expired',
            statusReason: `price_drift_exceeded:${(driftPct * 100).toFixed(2)}pct`,
            decidedAt: currentNow,
            revision: { increment: 1 }
          }
        })
        if (cas.count === 1) transitions.push({ id: prop.id, to: 'expired', reason: 'price_drift_exceeded' })
        continue
      }

      const nextExecSession = nextStockTraderSession(prop.deadlineSession)
      const txRes = await prismaClient.$transaction(async (tx) => {
        const fresh = await tx.copilotProposal.findUnique({ where: { id: prop.id } })
        if (!fresh || fresh.status !== 'pending_veto') {
          return { admitted: false, reason: 'concurrent_state_transition' }
        }
        return admitProposalPaperExecutionTx(tx, {
          proposal: fresh,
          nextStatus: 'auto_queued_paper',
          executionPrice: marketPrice,
          targetSession: nextExecSession,
          now: currentNow,
          statusReason: 'unvetoed_1_session_paper_window'
        })
      })

      if (txRes.admitted) {
        transitions.push({ id: prop.id, to: 'auto_queued_paper', executionId: txRes.execution.id })
      } else if (txRes.reason !== 'concurrent_state_transition') {
        await prismaClient.copilotProposal.updateMany({
          where: { id: prop.id, status: 'pending_veto', revision: prop.revision },
          data: {
            status: 'expired',
            statusReason: txRes.reason,
            decidedAt: currentNow,
            revision: { increment: 1 }
          }
        })
        transitions.push({ id: prop.id, to: 'expired', reason: txRes.reason })
      }
    }
  }

  // Sync queued proposals whose simulated Execution has filled -> `executed`
  const queuedProposals = await prismaClient.copilotProposal.findMany({
    where: {
      status: { in: ['approved', 'auto_queued_paper'] },
      executionId: { not: null },
      ...(userId ? { userId: String(userId) } : {})
    }
  })

  for (const qp of queuedProposals) {
    const exec = await prismaClient.execution.findUnique({ where: { id: qp.executionId } })
    if (!exec) continue
    if (exec.status === 'filled') {
      const cas = await prismaClient.copilotProposal.updateMany({
        where: { id: qp.id, status: { in: ['approved', 'auto_queued_paper'] }, revision: qp.revision },
        data: {
          status: 'executed',
          executedAt: exec.filledAt || currentNow,
          statusReason: 'simulated_fill_completed',
          revision: { increment: 1 }
        }
      })
      if (cas.count === 1) transitions.push({ id: qp.id, to: 'executed', executionId: exec.id })
    } else if (['cancelled', 'refused', 'failed'].includes(exec.status)) {
      await prismaClient.copilotProposal.updateMany({
        where: { id: qp.id, status: { in: ['approved', 'auto_queued_paper'] }, revision: qp.revision },
        data: {
          status: 'cancelled',
          statusReason: `execution_${exec.status}`,
          revision: { increment: 1 }
        }
      })
    }
  }

  return { reconciledCount: transitions.length, transitions }
}

export async function listUserCopilotProposals(
  userId,
  { prismaClient = prisma, now = () => new Date(), reconcile = true } = {}
) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new CopilotProposalError('User authentication required', 'UNAUTHORIZED', 401)

  if (reconcile) {
    await reconcileDueCopilotProposals({ userId: uid, prismaClient, now })
  }

  const [actionableRows, resolvedRows] = await Promise.all([
    prismaClient.copilotProposal.findMany({
      where: { userId: uid, status: { in: [...COPILOT_PENDING_STATUSES] } },
      orderBy: [{ deadlineAt: 'asc' }, { createdAt: 'desc' }]
    }),
    prismaClient.copilotProposal.findMany({
      where: { userId: uid, status: { notIn: [...COPILOT_PENDING_STATUSES] } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 15
    })
  ])

  return {
    actionable: actionableRows.map(enrichProposalForClient),
    recentResolved: resolvedRows.map(enrichProposalForClient),
    counts: {
      actionable: actionableRows.length,
      recentResolved: resolvedRows.length
    }
  }
}
