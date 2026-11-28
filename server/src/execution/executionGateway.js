/**
 * ExecutionGateway — Scheduled Simulated Session Settlement (P2 Consolidation)
 *
 * Unifies session-targeted simulated orders (`next_open` and `daily_close` orders queued by
 * Flagship AI Stock Trader, Personal AI Trader, Copilot Proposals, and Catalyst Momentum)
 * onto `InternalSimulatorProvider` with one compare-and-swap claim + audit lifecycle.
 */
import { randomUUID } from 'node:crypto'
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { calculateFillPnl } from '../services/botAccountingService.js'
import {
  claimQueuedAiPaperExecution,
  completeClaimedAiPaperExecution,
  quarantineClaimedAiPaperExecution
} from '../services/ai/paperExecutionClaims.js'
import { InternalSimulatorProvider } from './providers/InternalSimulatorProvider.js'

/**
 * Settles a single queued session-targeted simulated Execution through InternalSimulatorProvider.
 */
export async function settleScheduledSimulatedExecution(
  exec,
  {
    currentSession = null,
    prismaClient = prisma,
    engine = engineClient,
    workerId = 'execution_gateway_sim'
  } = {}
) {
  const session = exec.simSession || currentSession
  if (!session || (currentSession && session > currentSession)) {
    return { status: 'deferred', id: exec.id }
  }

  const mode = exec.sourceType === 'AI_REPLAY' ? 'historical_replay' : 'paper_daily'
  const workerToken = `egw_sim_${randomUUID()}`
  let claimed = false

  try {
    const audit = await prismaClient.executionAudit.findFirst({
      where: { executionId: exec.id, eventType: 'execution_created' }
    })
    const declaredModel = audit?.metadata?.entryType || audit?.metadata?.executionModel
    const executionModel = declaredModel === 'next_close' ? 'daily_close' : declaredModel || 'next_open'
    if (!['next_open', 'daily_close'].includes(executionModel)) {
      throw new Error('Unsupported simulated fill model')
    }

    // Pre-flight exact-session mark verification before claiming the row
    const priceSnapshot = await engine.getSessionClose(exec.ticker, session)
    const referencePrice = Number(executionModel === 'next_open' ? priceSnapshot?.open : priceSnapshot?.close)
    if (priceSnapshot?.session !== session || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      return { status: 'failed_precheck', id: exec.id, error: 'required_session_price_unavailable' }
    }

    claimed = await claimQueuedAiPaperExecution({
      prismaClient,
      executionId: exec.id,
      workerToken
    })
    if (!claimed) return { status: 'already_claimed', id: exec.id }

    const provider = new InternalSimulatorProvider(exec.userId, {
      portfolioId: exec.portfolioId ?? null,
      config: { enabled: true, mode, executionModel },
      prismaClient,
      sessionClose: (ticker, s) => engine.getSessionClose(ticker, s),
      resolveSession: () => session
    })

    const filledOrder = await provider.submitOrder({
      ticker: exec.ticker,
      side: exec.direction,
      qty: exec.quantity,
      clientOrderId: exec.clientOrderId,
      executionModel
    })

    const price = Number(filledOrder.filledAvgPrice)
    const quantity = Number(filledOrder.filledQty)
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('InternalSimulatorProvider returned an invalid fill')
    }

    const pnl = String(exec.direction).toLowerCase() === 'sell'
      ? await calculateFillPnl({ execution: exec, fillPrice: price, fillQty: quantity, prismaClient })
      : 0

    const fill = {
      brokerOrderId: filledOrder.alpacaOrderId,
      price,
      quantity,
      pnl,
      filledAt: filledOrder.filledAt || new Date(),
      session,
      priceModel: executionModel,
      isReplay: mode === 'historical_replay',
      marketObservation: filledOrder.marketObservation ?? null,
      auditId: `aud_${randomUUID()}`
    }

    await completeClaimedAiPaperExecution({
      prismaClient,
      execution: exec,
      workerToken,
      fill,
      workerId
    })

    return {
      status: 'filled',
      filledExecution: {
        id: exec.id,
        ticker: exec.ticker,
        direction: exec.direction,
        quantity,
        fillPrice: price,
        session,
        pnl,
        brokerOrderId: fill.brokerOrderId,
        isReplay: fill.isReplay,
        marketObservation: fill.marketObservation
      }
    }
  } catch (error) {
    if (claimed) {
      await quarantineClaimedAiPaperExecution({
        prismaClient,
        executionId: exec.id,
        workerToken
      }).catch((quarantineError) => {
        console.error('[executionGateway] failed to quarantine uncertain simulated fill:', quarantineError)
      })
    }
    return {
      status: 'error',
      id: exec.id,
      error: error.message,
      needsReconciliation: claimed
    }
  }
}
