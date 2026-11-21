import { createHash, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'

const VERSION = 'research-trace/v1'

function evidenceIsValid(json, snapshot, hex) {
  if (typeof json !== 'string' || json.length > 200000 ||
      typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) return false
  try {
    if (!isDeepStrictEqual(JSON.parse(json), snapshot)) return false
    const actual = createHash('sha256').update(json, 'utf8').digest()
    return timingSafeEqual(actual, Buffer.from(hex, 'hex'))
  } catch {
    return false
  }
}

export function verifyResearchTrace(trace, { predictionId, tenantId } = {}) {
  if (!trace || trace.schemaVersion !== VERSION || trace.decisionReference?.schemaVersion !== VERSION ||
      typeof trace.traceId !== 'string' || !/^research:[a-f0-9]{64}$/.test(trace.traceId) ||
      trace.decisionReference.traceId !== trace.traceId ||
      trace.source?.system !== 'alpha-engine' || trace.source.kind !== 'stored_prediction' ||
      !trace.source.predictionId || trace.decisionReference.predictionId !== trace.source.predictionId ||
      (predictionId && trace.source.predictionId !== predictionId) ||
      (tenantId && trace.tenant_id !== tenantId) ||
      trace.trading?.actionable !== false || trace.trading.executionPermission !== false ||
      trace.evidence?.snapshot?.predictionId !== trace.source.predictionId ||
      trace.evidence.snapshot.ticker !== trace.source.ticker ||
      trace.evidence.snapshot.observedAt !== trace.source.observedAt ||
      trace.evidence.sha256 !== trace.decisionReference.evidenceSha256) return false
  return evidenceIsValid(trace.evidence.canonicalJson, trace.evidence.snapshot, trace.evidence.sha256)
}

const DECISIONS = ['accepted', 'rejected', 'suppressed']

function codedError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

/**
 * Fetch the stored Alpha Engine trace and verify it before anything decides on it.
 * Throws RESEARCH_EVIDENCE_UNAVAILABLE when unreachable, missing, or not verifiable.
 */
export async function fetchVerifiedResearchTrace(predictionId, tenantId = 'default') {
  if (!predictionId) throw codedError('RESEARCH_EVIDENCE_UNAVAILABLE', 'predictionId is required')
  let trace
  try {
    trace = await engineClient.getPredictionTrace(predictionId, tenantId)
  } catch (err) {
    const e = codedError('RESEARCH_EVIDENCE_UNAVAILABLE', 'Alpha Engine research evidence is unavailable')
    e.cause = err
    throw e
  }
  if (!verifyResearchTrace(trace, { predictionId, tenantId })) {
    throw codedError('RESEARCH_EVIDENCE_UNAVAILABLE', 'Alpha Engine research evidence could not be verified')
  }
  return trace
}

/**
 * Persist a decision together with the exact verified trace it was made on.
 * `client` may be a transaction so the decision commits atomically with its execution.
 * Trusted bot decision writer only. This is not a trading or authorization API.
 */
export async function recordResearchDecision({ userId, botId, tenantId = 'default', trace, decision, detail, context, client = prisma }) {
  const predictionId = trace?.source?.predictionId
  if (!userId || !botId || !predictionId || !DECISIONS.includes(decision)) {
    throw new Error('Valid user, bot, prediction and decision are required')
  }
  // Defense in depth: never persist evidence that does not verify, even from a caller.
  if (!verifyResearchTrace(trace, { predictionId, tenantId })) {
    throw codedError('RESEARCH_EVIDENCE_UNAVAILABLE', 'Alpha Engine research evidence could not be verified')
  }
  const bot = await client.bot.findFirst({ where: { id: botId, userId, deletedAt: null } })
  if (!bot) throw codedError('NOT_FOUND', 'Bot not found')
  return client.botEvent.create({
    data: {
      id: generateId(ID_PREFIXES.EVENT),
      botId: bot.id, portfolioId: bot.portfolioId, type: 'decision_made',
      detail: detail || ('Bot ' + decision + ' ' + trace.source.ticker),
      metadata: {
        ticker: trace.source.ticker,
        decision, predictionId,
        ...(context ? { decisionContext: context } : {}),
        researchTrace: trace.decisionReference,
        researchEvidence: trace.evidence.snapshot,
        researchCanonicalJson: trace.evidence.canonicalJson,
        researchIntegrity: { sha256: trace.evidence.sha256, verifiedAtCapture: true },
        researchSource: trace.source,
        researchProvenance: { schemaVersion: VERSION, signed: false, immutableStorageVerified: false }
      }
    }
  })
}

/** Trusted bot decision writer only. This is not a trading or authorization API. */
export async function captureResearchDecision({ userId, botId, tenantId = 'default', predictionId, decision, detail }) {
  if (!userId || !botId || !predictionId || !DECISIONS.includes(decision)) {
    throw new Error('Valid user, bot, prediction and decision are required')
  }
  // Ownership first: never fetch research for a bot the caller does not own.
  const bot = await prisma.bot.findFirst({ where: { id: botId, userId, deletedAt: null } })
  if (!bot) throw codedError('NOT_FOUND', 'Bot not found')
  const trace = await fetchVerifiedResearchTrace(predictionId, tenantId)
  return recordResearchDecision({ userId, botId, tenantId, trace, decision, detail })
}

/** Verify archived snapshot without consulting mutable current research. */
export function verifyCapturedResearch(event) {
  const meta = event?.metadata
  if (!meta?.researchTrace || !meta?.researchEvidence || !meta?.researchIntegrity?.sha256) {
    return { status: 'unavailable', reason: 'research_snapshot_not_captured' }
  }
  const expected = meta.researchTrace.evidenceSha256
  return {
    status: expected === meta.researchIntegrity.sha256 &&
      evidenceIsValid(meta.researchCanonicalJson, meta.researchEvidence, expected)
      ? 'verified_digest' : 'mismatch',
    note: 'Digest integrity does not prove authenticity or predictive accuracy'
  }
}
