import prisma from '../loaders/prisma.js'
import { verifyCapturedResearch } from './researchTraceService.js'

const missing = { status: 'unavailable', reason: 'no_linked_research_decision' }

function error(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function matchesDecision(event, execution) {
  const meta = event?.metadata
  const source = meta?.researchSource
  return event?.type === 'decision_made' &&
    event.botId === execution.botId &&
    event.portfolioId === execution.portfolioId &&
    event.executionId === execution.id &&
    meta?.decision === 'accepted' &&
    !!meta?.predictionId &&
    source?.predictionId === meta.predictionId &&
    meta.researchEvidence?.predictionId === meta.predictionId &&
    // Alpha research IDs are not foreign keys into TradeLoom's Prediction table.
    // When an execution explicitly links a local prediction, it must agree.
    (!execution.predictionId || execution.predictionId === meta.predictionId) &&
    String(source?.ticker || '').toUpperCase() === String(execution.ticker).toUpperCase() &&
    (String(execution.direction).toLowerCase() === 'buy' ? 
      ['buy', 'up'].includes(String(meta.researchEvidence?.direction).toLowerCase()) :
      ['sell', 'down'].includes(String(meta.researchEvidence?.direction).toLowerCase()))
}

/**
 * Correlate an existing trusted decision event with an already-created execution.
 * The decision must be captured and accepted first. Never submits a broker order.
 * Not exposed as a public route: call only from the trusted decision writer.
 */
export async function linkResearchDecisionToExecution({ userId, decisionEventId, executionId }) {
  if (!userId || !decisionEventId || !executionId) throw error('INVALID_LINK', 'IDs are required')
  return prisma.$transaction(async (tx) => {
    const execution = await tx.execution.findUnique({ where: { id: executionId } })
    if (!execution || execution.userId !== userId || !execution.botId || execution.origin !== 'bot') {
      throw error('NOT_FOUND', 'Execution not found')
    }
    const event = await tx.botEvent.findUnique({ where: { id: decisionEventId } })
    if (!event || event.botId !== execution.botId || event.portfolioId !== execution.portfolioId ||
        event.type !== 'decision_made' || event.metadata?.decision !== 'accepted' ||
        !event.metadata?.predictionId ||
        event.metadata?.researchSource?.predictionId !== event.metadata.predictionId ||
        (execution.predictionId && event.metadata.predictionId !== execution.predictionId) ||
        String(event.metadata?.researchSource?.ticker || '').toUpperCase() !== String(execution.ticker).toUpperCase() ||
        event.metadata?.researchEvidence?.predictionId !== event.metadata.predictionId ||
        !(
          String(execution.direction).toLowerCase() === 'buy'
            ? ['buy', 'up'].includes(String(event.metadata?.researchEvidence?.direction || '').toLowerCase())
            : ['sell', 'down'].includes(String(event.metadata?.researchEvidence?.direction || '').toLowerCase())
        )) {
      throw error('INVALID_LINK', 'Research decision does not match execution')
    }
    const integrity = verifyCapturedResearch(event)
    if (integrity.status !== 'verified_digest') {
      throw error('INVALID_EVIDENCE', 'Research evidence integrity unavailable')
    }
    // Only a decision that has never been linked can be claimed. Repeats
    // of the same link are idempotent; attempts to move a link are rejected.
    if (event.executionId === executionId) return event
    if (event.executionId) throw error('ALREADY_LINKED', 'Decision is already linked')
    // Never associate more than one accepted decision with an execution.
    const existing = await tx.botEvent.findFirst({
      where: { executionId, type: 'decision_made' }
    })
    if (existing) throw error('ALREADY_LINKED', 'Execution already has a decision')
    const claimed = await tx.botEvent.updateMany({
      where: { id: decisionEventId, executionId: null },
      data: { executionId }
    })
    if (claimed.count !== 1) throw error('ALREADY_LINKED', 'Decision changed concurrently')
    return tx.botEvent.findUnique({ where: { id: decisionEventId } })
  })
}

/**
 * Read-only trade history evidence. Ownership is always checked before
 * event lookup. No live Alpha Engine calls or inferred stock/date matching.
 */
export async function getExecutionResearch({ userId, executionId }) {
  const execution = await prisma.execution.findUnique({ where: { id: executionId } })
  if (!execution || execution.userId !== userId) {
    throw error('NOT_FOUND', 'Execution not found')
  }
  if (!execution.botId || execution.origin !== 'bot') {
    return { ...missing, executionId }
  }
  const events = await prisma.botEvent.findMany({
    where: { executionId, botId: execution.botId, type: 'decision_made' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 2
  })
  if (!events.length) return { ...missing, executionId }
  if (events.length !== 1 || !matchesDecision(events[0], execution)) {
    return { status: 'mismatch', reason: 'research_decision_link_inconsistent', executionId }
  }
  const event = events[0]
  const integrity = verifyCapturedResearch(event)
  if (integrity.status !== 'verified_digest') {
    return { status: integrity.status, reason: integrity.reason || 'research_digest_mismatch', executionId }
  }
  return {
    status: 'verified_digest',
    executionId,
    botId: execution.botId,
    decisionEventId: event.id,
    predictionId: event.metadata.predictionId,
    researchTrace: event.metadata.researchTrace,
    evidence: event.metadata.researchEvidence,
    decision: event.metadata.decision,
    decisionAt: event.createdAt,
    note: 'SHA-256 consistency is not an authenticity signature or evidence of performance'
  }
}
