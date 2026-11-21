import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('../../src/loaders/prisma.js', () => ({
  default: { bot: { findFirst: vi.fn() }, botEvent: { create: vi.fn() } }
}))
vi.mock('../../src/clients/engine.js', () => ({
  engineClient: { getPredictionTrace: vi.fn() }
}))
vi.mock('../../src/utils/idGenerator.js', () => ({
  ID_PREFIXES: { EVENT: 'evt' }, generateId: vi.fn(() => 'evt_trace_test')
}))

import prisma from '../../src/loaders/prisma.js'
import { engineClient } from '../../src/clients/engine.js'
import { captureResearchDecision, verifyResearchTrace, verifyCapturedResearch } from '../../src/services/researchTraceService.js'

const snapshot = { confidence: 0.73, entryPrice: 540, predictionId: 'p1', ticker: 'SPY', observedAt: '2026-04-21T13:00:00Z' }
// The Python serializer preserves 540.0, while JSON.stringify emits 540.
const canonicalJson = '{"confidence":0.73,"entryPrice":540.0,"observedAt":"2026-04-21T13:00:00Z","predictionId":"p1","ticker":"SPY"}'
const sha = createHash('sha256').update(canonicalJson).digest('hex')
const traceId = 'research:' + 'a'.repeat(64)
const trace = {
  schemaVersion: 'research-trace/v1', traceId, tenant_id: 'default',
  source: { system: 'alpha-engine', kind: 'stored_prediction', predictionId: 'p1', ticker: 'SPY', observedAt: snapshot.observedAt },
  decisionReference: { schemaVersion: 'research-trace/v1', traceId, predictionId: 'p1', evidenceSha256: sha },
  evidence: { snapshot, canonicalJson, sha256: sha },
  trading: { actionable: false, executionPermission: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.bot.findFirst.mockResolvedValue({ id: 'bot1', portfolioId: 'portfolio1', userId: 'u1' })
  prisma.botEvent.create.mockImplementation(async ({ data }) => ({ ...data }))
  engineClient.getPredictionTrace.mockResolvedValue(structuredClone(trace))
})

describe('research evidence capture', () => {
  it('accepts Python canonical numeric formatting', () => {
    expect(verifyResearchTrace(trace, { predictionId: 'p1', tenantId: 'default' })).toBe(true)
  })
  it('persists the exact research snapshot in bot event metadata', async () => {
    const event = await captureResearchDecision({ userId: 'u1', botId: 'bot1', predictionId: 'p1', decision: 'accepted' })
    expect(event.metadata.researchTrace.evidenceSha256).toBe(sha)
    expect(event.metadata.researchEvidence).toEqual(snapshot)
    expect(verifyCapturedResearch(event).status).toBe('verified_digest')
  })
  it('rejects another user bot without fetching research', async () => {
    prisma.bot.findFirst.mockResolvedValue(null)
    await expect(captureResearchDecision({ userId: 'u2', botId: 'bot1', predictionId: 'p1', decision: 'rejected' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(engineClient.getPredictionTrace).not.toHaveBeenCalled()
    expect(prisma.botEvent.create).not.toHaveBeenCalled()
  })
  it('rejects tampered evidence', async () => {
    const changed = structuredClone(trace)
    changed.evidence.snapshot.confidence = 0.99
    engineClient.getPredictionTrace.mockResolvedValue(changed)
    await expect(captureResearchDecision({ userId: 'u1', botId: 'bot1', predictionId: 'p1', decision: 'accepted' })).rejects.toMatchObject({ code: 'RESEARCH_EVIDENCE_UNAVAILABLE' })
    expect(prisma.botEvent.create).not.toHaveBeenCalled()
  })
  it('does not fabricate evidence for old events', () => {
    expect(verifyCapturedResearch({ metadata: {} })).toEqual({ status: 'unavailable', reason: 'research_snapshot_not_captured' })
  })
  it('detects changes to persisted evidence', () => {
    const event = { metadata: {
      researchTrace: trace.decisionReference,
      researchEvidence: { ...snapshot, entryPrice: 999 },
      researchCanonicalJson: canonicalJson,
      researchIntegrity: { sha256: sha }
    }}
    expect(verifyCapturedResearch(event).status).toBe('mismatch')
  })
})
