import prisma from '../../loaders/prisma.js'
import { createResearchPartnerRepository, ResearchPartnerConflictError, ResearchPartnerNotFoundError } from './repository.js'
import { createResearchSessionService } from './researchSession.js'
import { createConversationInterpreter } from './conversationInterpretation.js'
import { ResearchPartnerInputError } from './mandate.js'

/** Pending, owner-scoped interpretation context. Business operations remain in existing services. */
export function createConversationDraftService({
  db = prisma, partners = createResearchPartnerRepository(db),
  sessions = createResearchSessionService({ db }),
  interpreter = createConversationInterpreter()
} = {}) {
  const ownedPartner = (userId, partnerId) => partners.get(userId, partnerId)
  async function ownedDraft(userId, partnerId, draftId) {
    await ownedPartner(userId, partnerId)
    const draft = await db.researchConversationDraft.findFirst({ where: { id: draftId, partnerId } })
    if (!draft) throw new ResearchPartnerNotFoundError()
    return draft
  }
  async function completedSession(userId, partnerId, sessionId) {
    if (!sessionId) return null
    const session = await sessions.get(userId, partnerId, sessionId)
    if (session.status !== 'completed') throw new ResearchPartnerConflictError('Selected investigation must be completed')
    return session
  }
  async function contextFor(partnerId, partner, session) {
    const recent = await db.researchSession.findMany({
      where: { partnerId }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { question: true, status: true }
    })
    return {
      mandateObjective: partner.mandate?.content?.objective || '',
      selectedInvestigation: session ? {
        question: session.question, summary: session.report?.summary || ''
      } : null,
      recentInvestigations: recent
    }
  }
  return {
    async list(userId, partnerId) {
      await ownedPartner(userId, partnerId)
      return db.researchConversationDraft.findMany({
        where: { partnerId }, orderBy: { updatedAt: 'desc' }, take: 25
      })
    },
    async get(userId, partnerId, draftId) { return ownedDraft(userId, partnerId, draftId) },
    async start(userId, partnerId, { text, sessionId = null }) {
      const partner = await ownedPartner(userId, partnerId)
      const session = await completedSession(userId, partnerId, sessionId)
      const result = await interpreter.interpret({
        userId, partnerId, text, hasCompletedSession: Boolean(session),
        context: await contextFor(partnerId, partner, session)
      })
      return db.researchConversationDraft.create({ data: {
        partnerId, sessionId: session?.id ?? null,
        mandateVersion: partner.currentMandateVersion,
        requestText: text.trim(), proposal: result, status: 'pending'
      } })
    },
    async answer(userId, partnerId, draftId, { text, expectedRevision }) {
      const draft = await ownedDraft(userId, partnerId, draftId)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 ||
          draft.revision !== expectedRevision || draft.status !== 'pending' ||
          draft.proposal?.type !== 'clarify' || draft.answerText) {
        throw new ResearchPartnerConflictError('Clarification is stale or already answered')
      }
      if (typeof text !== 'string' || !text.trim() || text.length > 700) {
        throw new ResearchPartnerInputError('Clarification must be 1–700 characters')
      }
      const partner = await ownedPartner(userId, partnerId)
      if (partner.currentMandateVersion !== draft.mandateVersion) {
        throw new ResearchPartnerConflictError('Research direction changed; start a new request')
      }
      const session = draft.sessionId
        ? await completedSession(userId, partnerId, draft.sessionId)
        : null
      const combined = [
        'Original request: ' + draft.requestText,
        'Clarification question: ' + draft.proposal.clarification,
        'User answer: ' + text.trim()
      ].join('\n')
      if (combined.length > 2000) throw new ResearchPartnerInputError('Clarification context exceeds budget')
      const interpretation = await interpreter.interpret({
        userId, partnerId, text: combined, hasCompletedSession: Boolean(session),
        context: await contextFor(partnerId, partner, session)
      })
      const changed = await db.researchConversationDraft.updateMany({
        where: { id: draft.id, partnerId, revision: expectedRevision, status: 'pending',
          answerText: null },
        data: { proposal: interpretation, answerText: text.trim(), revision: { increment: 1 } }
      })
      if (changed.count !== 1) throw new ResearchPartnerConflictError('Clarification was modified concurrently')
      return { ...draft, proposal: interpretation, answerText: text.trim(), revision: expectedRevision + 1 }
    },
    async close(userId, partnerId, draftId, { expectedRevision, status }) {
      if (!['dismissed', 'confirmed'].includes(status)) throw new ResearchPartnerInputError('Invalid conversation status')
      const draft = await ownedDraft(userId, partnerId, draftId)
      if (!Number.isSafeInteger(expectedRevision) || draft.revision !== expectedRevision ||
          draft.status !== 'pending') throw new ResearchPartnerConflictError('Conversation proposal is stale')
      if (status === 'confirmed' && draft.proposal?.type === 'clarify') {
        throw new ResearchPartnerConflictError('Answer the clarification before confirming')
      }
      const updated = await db.researchConversationDraft.updateMany({
        where: { id: draftId, partnerId, status: 'pending', revision: expectedRevision },
        data: { status, revision: { increment: 1 } }
      })
      if (updated.count !== 1) throw new ResearchPartnerConflictError('Conversation proposal was modified concurrently')
      return { ...draft, status, revision: expectedRevision + 1 }
    }
  }
}
