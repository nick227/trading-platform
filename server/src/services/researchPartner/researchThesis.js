
import prisma from '../../loaders/prisma.js'
import { ResearchPartnerNotFoundError, ResearchPartnerConflictError } from './repository.js'
import { ResearchPartnerInputError } from './mandate.js'

function validStatement(statement) {
  if (typeof statement !== 'string' || !statement.trim() || statement.length > 600) {
    throw new ResearchPartnerInputError('Invalid research thesis statement')
  }
  return statement.trim()
}
export function summarizeThesisHistory(assessments) {
  const timeline = [...assessments].sort((a,b) => new Date(a.recordedAt) - new Date(b.recordedAt))
  const latest = timeline.at(-1) || null
  const transitions = timeline.slice(1).filter((item,i) => item.assessment !== timeline[i].assessment).length
  return { latest: latest?.assessment || 'unassessed', assessments: timeline.length, transitions }
}
export function createResearchThesisService(db = prisma) {
  const ownedPartner = async (userId, partnerId) => {
    const partner = await db.researchPartner.findFirst({
      where: { id: partnerId, userId, status: { not: 'archived' } }
    })
    if (!partner) throw new ResearchPartnerNotFoundError()
  }
  const ownedThesis = async (userId, partnerId, thesisId) => {
    await ownedPartner(userId, partnerId)
    const thesis = await db.researchThesis.findFirst({ where: { id: thesisId, partnerId } })
    if (!thesis) throw new ResearchPartnerNotFoundError()
    return thesis
  }
  return {
    async create(userId, partnerId, statement) {
      await ownedPartner(userId, partnerId)
      return db.researchThesis.create({ data: { partnerId, statement: validStatement(statement) } })
    },
    async list(userId, partnerId) {
      await ownedPartner(userId, partnerId)
      const theses = await db.researchThesis.findMany({
        where: { partnerId }, orderBy: { createdAt: 'desc' },
        include: { assessments: { orderBy: { recordedAt: 'asc' }, take: 100 } },
        take: 100
      })
      return theses.map(t => ({ ...t, overview: summarizeThesisHistory(t.assessments) }))
    },
    async record(userId, partnerId, thesisId, sessionId, findingIndex) {
      const thesis = await ownedThesis(userId, partnerId, thesisId)
      if (!Number.isSafeInteger(findingIndex) || findingIndex < 0 || findingIndex > 11) {
        throw new ResearchPartnerInputError('Invalid research finding reference')
      }
      const session = await db.researchSession.findFirst({
        where: { id: sessionId, partnerId, status: 'completed' }
      })
      if (!session) throw new ResearchPartnerNotFoundError()
      const finding = session.report?.findings?.[findingIndex]
      if (!finding || !['supported', 'challenged', 'inconclusive'].includes(finding.assessment)) {
        throw new ResearchPartnerInputError('Finding is unavailable or invalid')
      }
      const knownIds = new Set((session.report.evidence || []).map(e => e.id))
      if ((finding.evidenceIds || []).some(id => !knownIds.has(id))) {
        throw new ResearchPartnerInputError('Finding cites unavailable source')
      }
      try {
        return await db.researchThesisAssessment.create({
          data: { thesisId: thesis.id, sessionId,
            claim: finding.claim.slice(0, 500), assessment: finding.assessment,
            evidenceIds: finding.evidenceIds || [] }
        })
      } catch (error) {
        if (error.code === 'P2002') throw new ResearchPartnerConflictError('Thesis already evaluated for this investigation')
        throw error
      }
    }
  }
}
