
import prisma from '../../loaders/prisma.js'
import { validateResearchQuestion, ResearchPartnerInputError } from './mandate.js'
import { createResearchPartnerRepository, ResearchPartnerConflictError, ResearchPartnerNotFoundError } from './repository.js'
import { createMandateProposalRuntime } from './mandateProposalRuntime.js'

const MAX_TURNS = 10
const MAX_CHARS = 700
function userTurn(input) {
  const text = validateResearchQuestion(input)
  if (text.length > MAX_CHARS) throw new ResearchPartnerInputError('Dialogue messages must be 700 characters or fewer')
  return { role: 'user', content: text }
}
function safeTranscript(dialogue, incoming) {
  if (!Array.isArray(dialogue.transcript) || dialogue.transcript.length >= MAX_TURNS) {
    throw new ResearchPartnerConflictError('Dialogue is full; approve or start a new one')
  }
  return [...dialogue.transcript, incoming]
}
function conversationPrompt(turns) {
  return turns.map((t, i) => 'User statement ' + (i + 1) + ': ' + t.content).join('\n').slice(0, 4000)
}
export function createMandateDialogueService({
  db = prisma, partnerRepo = createResearchPartnerRepository(db),
  proposals = createMandateProposalRuntime()
} = {}) {
  async function owned(userId, partnerId, dialogueId) {
    await partnerRepo.get(userId, partnerId)
    const dialogue = await db.researchMandateDialogue.findFirst({
      where: { id: dialogueId, partnerId }
    })
    if (!dialogue) throw new ResearchPartnerNotFoundError()
    return dialogue
  }
  return {
    async start(userId, partnerId, firstMessage, useAI = false) {
      const partner = await partnerRepo.get(userId, partnerId)
      const turn = userTurn(firstMessage)
      const proposal = await proposals.propose({
        userId, partner, instructions: turn.content, useAI
      })
      return db.researchMandateDialogue.create({
        data: { partnerId, baseVersion: partner.currentMandateVersion, revision: 1,
          transcript: [turn], proposal, status: 'draft' }
      })
    },
    async get(userId, partnerId, dialogueId) {
      return owned(userId, partnerId, dialogueId)
    },
    async addTurn(userId, partnerId, dialogueId, { text, expectedRevision, useAI = false }) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new ResearchPartnerInputError('Invalid dialogue revision')
      }
      const dialogue = await owned(userId, partnerId, dialogueId)
      if (dialogue.status !== 'draft' || dialogue.revision !== expectedRevision) throw new ResearchPartnerConflictError()
      const turns = safeTranscript(dialogue, userTurn(text))
      const partner = await partnerRepo.get(userId, partnerId)
      if (partner.currentMandateVersion !== dialogue.baseVersion) throw new ResearchPartnerConflictError('Mandate changed during dialogue')
      const proposal = await proposals.propose({
        userId, partner, instructions: conversationPrompt(turns), useAI
      })
      const result = await db.researchMandateDialogue.updateMany({
        where: { id: dialogue.id, partnerId, revision: expectedRevision, status: 'draft' },
        data: { revision: expectedRevision + 1, transcript: turns, proposal }
      })
      if (result.count !== 1) throw new ResearchPartnerConflictError('Dialogue was modified concurrently')
      return { ...dialogue, transcript: turns, proposal, revision: expectedRevision + 1 }
    },
    async approve(userId, partnerId, dialogueId, expectedRevision) {
      const dialogue = await owned(userId, partnerId, dialogueId)
      if (!Number.isSafeInteger(expectedRevision) || dialogue.status !== 'draft' ||
          dialogue.revision !== expectedRevision || !dialogue.proposal?.mandate) {
        throw new ResearchPartnerConflictError('Dialogue approval is stale or incomplete')
      }
      // Version compare-and-swap in the repository prevents double approvals.
      const version = await partnerRepo.reviseMandate(userId, partnerId, dialogue.baseVersion,
        dialogue.proposal.mandate)
      await db.researchMandateDialogue.updateMany({
        where: { id: dialogue.id, partnerId, status: 'draft', revision: expectedRevision },
        data: { status: 'approved' }
      })
      return version
    }
  }
}
