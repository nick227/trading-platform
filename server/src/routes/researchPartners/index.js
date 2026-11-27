
import { createResearchPartnerRepository } from '../../services/researchPartner/repository.js'
import { ResearchPartnerInputError } from '../../services/researchPartner/mandate.js'
import { proposeResearchMandate } from '../../services/researchPartner/mandateProposal.js'
import { createResearchSessionService } from '../../services/researchPartner/researchSession.js'

const repo = createResearchPartnerRepository()
const sessions = createResearchSessionService()
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
    properties: { instructions: { type: 'string', minLength: 1, maxLength: 4000 } }
  } } }, async (request, reply) => {
    try {
      const partner = await repo.get(owned(request), request.params.id)
      const proposal = await proposeResearchMandate({
        instructions: request.body.instructions,
        currentMandate: partner.mandate.content
      })
      return { data: { ...proposal, partnerId: partner.id, expectedVersion: partner.currentMandateVersion } }
    } catch (e) { return handle(reply, e) }
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
  app.delete('/:id', async (request, reply) => {
    try { await repo.archive(owned(request), request.params.id); return reply.code(204).send() }
    catch (e) { return handle(reply, e) }
  })
}
