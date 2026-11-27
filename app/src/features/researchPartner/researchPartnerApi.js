
import { get, post } from '../../api/client'

const base = '/research-partners'
const part = id => base + '/' + encodeURIComponent(id)
export const listResearchPartners = () => get(base)
export const createResearchPartner = input => post(base, input)
export const getResearchPartner = id => get(part(id))
export const proposeMandate = (id, instructions, useAI = false) => post(part(id) + '/mandates/proposals', { instructions, useAI })
export const approveMandate = (id, proposal) => post(part(id) + '/mandates', {
  expectedVersion: proposal.expectedVersion, mandate: proposal.mandate
})
export const listResearchSessions = id => get(part(id) + '/sessions')
export const createResearchSession = (id, question) => post(part(id) + '/sessions', { question })
export const runResearchSession = (id, sessionId) => post(part(id) + '/sessions/' + encodeURIComponent(sessionId) + '/run')

export const getResearchSession = (partnerId, sessionId) => get(part(partnerId) + '/sessions/' + encodeURIComponent(sessionId))
export const addResearchFeedback = (partnerId, sessionId, input) => post(part(partnerId) + '/sessions/' + encodeURIComponent(sessionId) + '/feedback', input)
export const createFollowUpResearch = (partnerId, sessionId, question) => post(part(partnerId) + '/sessions/' + encodeURIComponent(sessionId) + '/follow-ups', { question })

export const startResearchDialogue = (id, payload) => post(part(id) + '/mandates/dialogues', payload)
export const getResearchDialogue = (id, dialogueId) => get(part(id) + '/mandates/dialogues/' + encodeURIComponent(dialogueId))
export const continueResearchDialogue = (id, dialogueId, payload) => post(part(id) + '/mandates/dialogues/' + encodeURIComponent(dialogueId) + '/turns', payload)
export const approveResearchDialogue = (id, dialogueId, expectedRevision) => post(part(id) + '/mandates/dialogues/' + encodeURIComponent(dialogueId) + '/approve', { expectedRevision })

export const listResearchTheses = id => get(part(id) + '/theses')
export const createResearchThesis = (id, statement) => post(part(id) + '/theses', { statement })
export const linkThesisFinding = (id, thesisId, sessionId, findingIndex) =>
  post(part(id) + '/theses/' + encodeURIComponent(thesisId) + '/assessments', { sessionId, findingIndex })

export const listResearchPaperStrategies = id => get(part(id) + '/paper-strategies')
export const createResearchPaperStrategy = (id, definition) => post(part(id) + '/paper-strategies', { definition })
export const createPaperStrategyFromResearch = (id, payload) => post(part(id) + '/paper-strategies/from-research', payload)
export const previewPaperStrategyWithAI = (id, instructions) => post(part(id) + '/paper-strategies/proposals', { instructions })
export const approveResearchPaperStrategy = (id, strategyId, expectedVersion) =>
  post(part(id) + '/paper-strategies/' + encodeURIComponent(strategyId) + '/approve', { expectedVersion })

export const listResearchMonitors = id => get(part(id) + '/monitors')
export const createResearchMonitor = (id, payload) => post(part(id) + '/monitors', payload)
export const checkResearchMonitor = (id, monitorId) =>
  post(part(id) + '/monitors/' + encodeURIComponent(monitorId) + '/check')
export const setResearchMonitorStatus = (id, monitorId, status) =>
  post(part(id) + '/monitors/' + encodeURIComponent(monitorId) + '/status', { status })
