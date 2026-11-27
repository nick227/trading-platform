import prisma from '../../loaders/prisma.js'
import { validatePaperStrategy } from './paperStrategy.js'
import { ResearchPartnerConflictError, ResearchPartnerNotFoundError } from './repository.js'
import { ResearchPartnerInputError } from './mandate.js'

export function createResearchStrategyService(db = prisma) {
  async function partnerFor(userId, partnerId) {
    if (!userId || !partnerId) throw new ResearchPartnerInputError('Owner and research partner required')
    const partner = await db.researchPartner.findFirst({
      where: { id: partnerId, userId, status: { not: 'archived' } }
    })
    if (!partner) throw new ResearchPartnerNotFoundError()
    return partner
  }
  async function owned(userId, partnerId, strategyId) {
    await partnerFor(userId, partnerId)
    const strategy = await db.researchPaperStrategy.findFirst({ where: { id: strategyId, partnerId } })
    if (!strategy) throw new ResearchPartnerNotFoundError()
    return strategy
  }
  return {
    async create(userId, partnerId, definition, provenance = null) {
      await partnerFor(userId, partnerId)
      const spec = validatePaperStrategy(definition)
      return db.$transaction(async tx => {
        const strategy = await tx.researchPaperStrategy.create({
          data: { partnerId, name: spec.name, currentVersion: 1, status: 'draft' }
        })
        const revision = await tx.researchPaperStrategyVersion.create({
          data: { strategyId: strategy.id, version: 1, definition: spec,
            ...(provenance ? { provenance } : {}) }
        })
        return { ...strategy, revision }
      })
    },
    async fromResearch(userId, partnerId, { sessionId, findingIndex, definition }) {
      // Do not treat model conclusions as measurements. All executable criteria
      // arrive separately and must pass the strict paper strategy validator.
      await partnerFor(userId, partnerId)
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 191 ||
          !Number.isInteger(findingIndex) || findingIndex < 0 || findingIndex >= 12) {
        throw new ResearchPartnerInputError('Invalid research finding selection')
      }
      const session = await db.researchSession.findFirst({
        where: { id: sessionId, partnerId, status: 'completed' }
      })
      if (!session || !session.report) throw new ResearchPartnerNotFoundError()
      const finding = session.report.findings?.[findingIndex]
      if (!finding || !['supported', 'challenged', 'inconclusive'].includes(finding.assessment) ||
          typeof finding.claim !== 'string') {
        throw new ResearchPartnerInputError('Completed research finding is unavailable')
      }
      const sourceLookup = new Map((session.report.evidence || []).map(source => [source.id, source]))
      const references = Array.isArray(finding.evidenceIds) ? finding.evidenceIds : []
      if (references.length > 10 || references.some(id => !sourceLookup.has(id))) {
        throw new ResearchPartnerInputError('Research finding contains unavailable references')
      }
      // A finding without cited independent evidence remains provisional.
      const provenance = {
        kind: 'research_finding', sessionId, findingIndex,
        mandateVersion: session.mandateVersion,
        evidenceFingerprint: session.report.evidenceFingerprint || null,
        sourceStatus: references.length ? 'cited_unverified_interpretation' : 'no_independent_sources',
        finding: { claim: finding.claim.slice(0, 500), assessment: finding.assessment,
          evidenceIds: references },
        sources: references.map(id => {
          const src = sourceLookup.get(id)
          return { id, source: src.source, title: src.title || null,
            url: src.url || null, publishedAt: src.publishedAt || null,
            contentHash: src.contentHash || null }
        })
      }
      const spec = validatePaperStrategy(definition)
      return this.create(userId, partnerId, spec, provenance)
    },
    async list(userId, partnerId) {
      await partnerFor(userId, partnerId)
      return db.researchPaperStrategy.findMany({
        where: { partnerId }, orderBy: { createdAt: 'desc' }, take: 100,
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } }
      })
    },
    async get(userId, partnerId, strategyId) {
      const strategy = await owned(userId, partnerId, strategyId)
      const revision = await db.researchPaperStrategyVersion.findUnique({
        where: { strategyId_version: { strategyId, version: strategy.currentVersion } }
      })
      if (!revision) throw new ResearchPartnerConflictError('Strategy version missing')
      return { ...strategy, revision }
    },
    async revise(userId, partnerId, strategyId, expectedVersion, definition) {
      const strategy = await owned(userId, partnerId, strategyId)
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
          strategy.currentVersion !== expectedVersion || strategy.status === 'archived') {
        throw new ResearchPartnerConflictError('Stale strategy version')
      }
      const spec = validatePaperStrategy(definition)
      return db.$transaction(async tx => {
        const changed = await tx.researchPaperStrategy.updateMany({
          where: { id: strategyId, partnerId, currentVersion: expectedVersion,
            status: { not: 'archived' } },
          data: { currentVersion: expectedVersion + 1, name: spec.name, status: 'draft' }
        })
        if (changed.count !== 1) throw new ResearchPartnerConflictError('Strategy was updated')
        const revision = await tx.researchPaperStrategyVersion.create({
          data: { strategyId, version: expectedVersion + 1, definition: spec }
        })
        return { version: revision.version, revision }
      })
    },
    async approve(userId, partnerId, strategyId, expectedVersion) {
      const strategy = await owned(userId, partnerId, strategyId)
      if (strategy.currentVersion !== expectedVersion || strategy.status !== 'draft') {
        throw new ResearchPartnerConflictError('Strategy approval is stale')
      }
      const changed = await db.researchPaperStrategy.updateMany({
        where: { id: strategyId, partnerId, currentVersion: expectedVersion, status: 'draft' },
        data: { status: 'approved_paper_definition' }
      })
      if (changed.count !== 1) throw new ResearchPartnerConflictError('Strategy approval conflicted')
      return { strategyId, version: expectedVersion, status: 'approved_paper_definition',
        executionEnabled: false }
    }
  }
}
