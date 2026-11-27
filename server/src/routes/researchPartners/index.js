
import { createResearchPartnerRepository } from '../../services/researchPartner/repository.js'
import { ResearchPartnerInputError } from '../../services/researchPartner/mandate.js'
import { createMandateProposalRuntime } from '../../services/researchPartner/mandateProposalRuntime.js'
import { createResearchSessionService } from '../../services/researchPartner/researchSession.js'
import { createMandateDialogueService } from '../../services/researchPartner/mandateDialogue.js'
import { createResearchThesisService } from '../../services/researchPartner/researchThesis.js'
import { createResearchStrategyService } from '../../services/researchPartner/paperStrategyService.js'
import { createPaperStrategyProposalRuntime } from '../../services/researchPartner/paperStrategyProposalRuntime.js'

const repo = createResearchPartnerRepository()
const sessions = createResearchSessionService()
const dialogues = createMandateDialogueService()
const theses = createResearchThesisService()
const strategies = createResearchStrategyService()
const paperProposals = createPaperStrategyProposalRuntime()
const proposalRuntime = createMandateProposalRuntime()
const bodySchema = { type: 'object', additionalProperties: false }
function handle(reply, error) {
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: { code: error.name, message: error.message } })
  }
  throw error
}
const owned = request => request.user.id

export default async function researchPartnerRoutes(app) {
  app.post('/', { schema: { body: {
    ...bodySchema, required: ['name'],
    properties: { name: { type: 'string' }, objective: { type: 'string' }, mandate: { type: 'object' } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await repo.create(owned(request), request.body) }) }
    catch (e) { return handle(reply, e) }
  })
  app.get('/', async (request, reply) => {
    try { return { data: await repo.list(owned(request)) } }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id', async (request, reply) => {
    try { return { data: await repo.get(owned(request), request.params.id) } }
    catch (e) { return handle(reply, e) }
  })
  app.patch('/:id', { schema: { body: {
    ...bodySchema, required: ['name', 'expectedUpdatedAt'],
    properties: { name: { type: 'string' }, expectedUpdatedAt: { type: 'string' } }
  } } }, async (request, reply) => {
    try { return { data: await repo.rename(owned(request), request.params.id, request.body.name, request.body.expectedUpdatedAt) } }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/mandates', { schema: { body: {
    ...bodySchema, required: ['expectedVersion', 'mandate'],
    properties: { expectedVersion: { type: 'integer', minimum: 1 }, mandate: { type: 'object' } }
  } } }, async (request, reply) => {
    try {
      return reply.code(201).send({ data: await repo.reviseMandate(owned(request), request.params.id,
        request.body.expectedVersion, request.body.mandate) })
    } catch (e) { return handle(reply, e) }
  })

  app.post('/:id/mandates/proposals', { schema: { body: {
    ...bodySchema, required: ['instructions'],
    properties: { instructions: { type: 'string', minLength: 1, maxLength: 4000 }, useAI: { type: 'boolean' } }
  } } }, async (request, reply) => {
    try {
      const partner = await repo.get(owned(request), request.params.id)
      const proposal = await proposalRuntime.propose({
        userId: owned(request), partner, instructions: request.body.instructions,
        useAI: request.body.useAI === true
      })
      return { data: { ...proposal, partnerId: partner.id, expectedVersion: partner.currentMandateVersion } }
    } catch (e) { return handle(reply, e) }
  })

  app.post('/:id/mandates/dialogues', { schema: { body: { ...bodySchema,
    required: ['message'], properties: {
      message: { type: 'string', minLength: 1, maxLength: 700 },
      useAI: { type: 'boolean' }
    }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await dialogues.start(owned(request), request.params.id,
      request.body.message, request.body.useAI === true) }) }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id/mandates/dialogues/:dialogueId', async (request, reply) => {
    try { return { data: await dialogues.get(owned(request), request.params.id, request.params.dialogueId) } }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/mandates/dialogues/:dialogueId/turns', { schema: { body: { ...bodySchema,
    required: ['text', 'expectedRevision'], properties: {
      text: { type: 'string', minLength: 1, maxLength: 700 },
      expectedRevision: { type: 'integer', minimum: 1 }, useAI: { type: 'boolean' }
    }
  } } }, async (request, reply) => {
    try { return { data: await dialogues.addTurn(owned(request), request.params.id,
      request.params.dialogueId, request.body) } }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/mandates/dialogues/:dialogueId/approve', { schema: { body: { ...bodySchema,
    required: ['expectedRevision'], properties: { expectedRevision: { type: 'integer', minimum: 1 } }
  } } }, async (request, reply) => {
    try { return { data: await dialogues.approve(owned(request), request.params.id,
      request.params.dialogueId, request.body.expectedRevision) } }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id/mandates', async (request, reply) => {
    try { return { data: await repo.listMandates(owned(request), request.params.id) } }
    catch (e) { return handle(reply, e) }
  })

  app.post('/:id/sessions', { schema: { body: {
    ...bodySchema, required: ['question'],
    properties: { question: { type: 'string', minLength: 1, maxLength: 6000 } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await sessions.create(owned(request), request.params.id, request.body.question) }) }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id/sessions', async (request, reply) => {
    try { return { data: await sessions.list(owned(request), request.params.id) } }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id/sessions/:sessionId', async (request, reply) => {
    try { return { data: await sessions.get(owned(request), request.params.id, request.params.sessionId) } }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/sessions/:sessionId/run', async (request, reply) => {
    try { return { data: await sessions.run(owned(request), request.params.id, request.params.sessionId) } }
    catch (e) { return handle(reply, e) }
  })

  app.post('/:id/sessions/:sessionId/feedback', { schema: { body: {
    ...bodySchema, required: ['text', 'category'],
    properties: { text: { type: 'string', minLength: 1, maxLength: 2000 },
      category: { type: 'string', enum: ['challenge', 'clarification', 'correction', 'additional_evidence'] } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await sessions.addFeedback(owned(request), request.params.id,
      request.params.sessionId, request.body) }) }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/sessions/:sessionId/follow-ups', { schema: { body: {
    ...bodySchema, required: ['question'],
    properties: { question: { type: 'string', minLength: 1, maxLength: 6000 } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await sessions.createFollowUp(owned(request), request.params.id,
      request.params.sessionId, request.body.question) }) }
    catch (e) { return handle(reply, e) }
  })



  app.post('/:id/paper-strategies/proposals', { schema: { body: {
    ...bodySchema, required: ['instructions'],
    properties: { instructions: { type: 'string', minLength: 1, maxLength: 3000 } }
  } } }, async (request, reply) => {
    try {
      const partner = await repo.get(owned(request), request.params.id)
      return { data: await paperProposals.propose({
        userId: owned(request), partner, instructions: request.body.instructions
      }) }
    } catch (e) { return handle(reply, e) }
  })

  app.post('/:id/paper-strategies/from-research', { schema: { body: {
    ...bodySchema, required: ['sessionId','findingIndex','definition'],
    properties: { sessionId: { type: 'string', minLength: 1, maxLength: 191 },
      findingIndex: { type: 'integer', minimum: 0, maximum: 11 },
      definition: { type: 'object' } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await strategies.fromResearch(owned(request),
      request.params.id, request.body) }) }
    catch (e) { return handle(reply, e) }
  })

  app.post('/:id/paper-strategies', { schema: { body: { ...bodySchema,
    required: ['definition'], properties: { definition: { type: 'object' } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await strategies.create(owned(request), request.params.id, request.body.definition) }) }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id/paper-strategies', async (request, reply) => {
    try { return { data: await strategies.list(owned(request), request.params.id) } }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id/paper-strategies/:strategyId', async (request, reply) => {
    try { return { data: await strategies.get(owned(request), request.params.id, request.params.strategyId) } }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/paper-strategies/:strategyId/revisions', { schema: { body: { ...bodySchema,
    required: ['expectedVersion','definition'], properties: {
      expectedVersion: { type: 'integer', minimum: 1 }, definition: { type: 'object' }
    }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await strategies.revise(owned(request), request.params.id,
      request.params.strategyId, request.body.expectedVersion, request.body.definition) }) }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/paper-strategies/:strategyId/approve', { schema: { body: { ...bodySchema,
    required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } }
  } } }, async (request, reply) => {
    try { return { data: await strategies.approve(owned(request), request.params.id,
      request.params.strategyId, request.body.expectedVersion) } }
    catch (e) { return handle(reply, e) }
  })

  app.post('/:id/theses', { schema: { body: { ...bodySchema, required: ['statement'],
    properties: { statement: { type: 'string', minLength: 1, maxLength: 600 } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await theses.create(owned(request), request.params.id, request.body.statement) }) }
    catch (e) { return handle(reply, e) }
  })
  app.get('/:id/theses', async (request, reply) => {
    try { return { data: await theses.list(owned(request), request.params.id) } }
    catch (e) { return handle(reply, e) }
  })
  app.post('/:id/theses/:thesisId/assessments', { schema: { body: {
    ...bodySchema, required: ['sessionId', 'findingIndex'],
    properties: { sessionId: { type: 'string', minLength: 1, maxLength: 191 },
      findingIndex: { type: 'integer', minimum: 0, maximum: 11 } }
  } } }, async (request, reply) => {
    try { return reply.code(201).send({ data: await theses.record(owned(request), request.params.id,
      request.params.thesisId, request.body.sessionId, request.body.findingIndex) }) }
    catch (e) { return handle(reply, e) }
  })
  app.delete('/:id', async (request, reply) => {
    try { await repo.archive(owned(request), request.params.id); return reply.code(204).send() }
    catch (e) { return handle(reply, e) }
  })
}
