import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/loaders/prisma.js', () => ({
  default: {
    execution: { findUnique: vi.fn() },
    botEvent: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn) => fn(prisma))
  }
}))
vi.mock('../../src/services/researchTraceService.js', () => ({
  verifyCapturedResearch: vi.fn(() => ({ status: 'verified_digest' }))
}))

import prisma from '../../src/loaders/prisma.js'
import { verifyCapturedResearch } from '../../src/services/researchTraceService.js'
import { getExecutionResearch, linkResearchDecisionToExecution } from '../../src/services/executionResearchService.js'

const execution = {
  id: 'ex1', userId: 'u1', botId: 'b1', portfolioId: 'pf1',
  predictionId: 'p1', ticker: 'SPY', direction: 'buy', origin: 'bot'
}
const event = {
  id: 'event1', botId: 'b1', portfolioId: 'pf1', executionId: 'ex1',
  type: 'decision_made', createdAt: new Date('2026-05-01T12:00:00Z'),
  metadata: {
    predictionId: 'p1', decision: 'accepted',
    researchSource: { predictionId: 'p1', ticker: 'SPY' },
    researchEvidence: { direction: 'buy', predictionId: 'p1' },
    researchTrace: { traceId: 'trace1' }
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  prisma.execution.findUnique.mockResolvedValue(execution)
  prisma.botEvent.findMany.mockResolvedValue([event])
  prisma.botEvent.findUnique.mockResolvedValue(event)
  prisma.botEvent.findFirst.mockResolvedValue(null)
  prisma.botEvent.updateMany.mockResolvedValue({ count: 1 })
  verifyCapturedResearch.mockReturnValue({ status: 'verified_digest' })
})

describe('execution research correlation', () => {
  it('returns the linked and verified snapshot', async () => {
    const found = await getExecutionResearch({ userId: 'u1', executionId: 'ex1' })
    expect(found.status).toBe('verified_digest')
    expect(found.decisionEventId).toBe('event1')
    expect(found.predictionId).toBe('p1')
  })
  it('does not reveal another users execution', async () => {
    await expect(getExecutionResearch({ userId: 'other', executionId: 'ex1' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.botEvent.findMany).not.toHaveBeenCalled()
  })
  it('does not infer a decision from a matching ticker', async () => {
    prisma.botEvent.findMany.mockResolvedValue([])
    expect((await getExecutionResearch({ userId: 'u1', executionId: 'ex1' })).status).toBe('unavailable')
  })
  it('rejects mismatched prediction or direction', async () => {
    prisma.botEvent.findMany.mockResolvedValue([{ ...event, metadata: { ...event.metadata, predictionId: 'other' } }])
    expect((await getExecutionResearch({ userId: 'u1', executionId: 'ex1' })).status).toBe('mismatch')
  })
  it('detects tampered research', async () => {
    verifyCapturedResearch.mockReturnValue({ status: 'mismatch' })
    expect((await getExecutionResearch({ userId: 'u1', executionId: 'ex1' })).status).toBe('mismatch')
  })
  it('rejects ambiguous duplicated decision links', async () => {
    prisma.botEvent.findMany.mockResolvedValue([event, { ...event, id: 'event2' }])
    expect((await getExecutionResearch({ userId: 'u1', executionId: 'ex1' })).status).toBe('mismatch')
  })
  it('links a previously captured accepted decision without an order submission', async () => {
    prisma.botEvent.findUnique.mockResolvedValueOnce({ ...event, executionId: null }).mockResolvedValueOnce(event)
    const linked = await linkResearchDecisionToExecution({ userId: 'u1', decisionEventId: 'event1', executionId: 'ex1' })
    expect(linked.id).toBe('event1')
    expect(prisma.botEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'event1', executionId: null }, data: { executionId: 'ex1' }
    })
  })
  it('rejects cross-account linkage', async () => {
    await expect(linkResearchDecisionToExecution({ userId: 'other', decisionEventId: 'event1', executionId: 'ex1' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.botEvent.updateMany).not.toHaveBeenCalled()
  })
  it('refuses to relink a decision', async () => {
    prisma.botEvent.findUnique.mockResolvedValue({ ...event, executionId: 'ex2' })
    await expect(linkResearchDecisionToExecution({ userId: 'u1', decisionEventId: 'event1', executionId: 'ex1' })).rejects.toMatchObject({ code: 'ALREADY_LINKED' })
  })
})
