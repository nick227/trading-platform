
import { get, post } from '../../api/client'

const base = '/research-partners'
const part = id => base + '/' + encodeURIComponent(id)
export const listResearchPartners = () => get(base)
export const createResearchPartner = input => post(base, input)
export const getResearchPartner = id => get(part(id))
export const proposeMandate = (id, instructions) => post(part(id) + '/mandates/proposals', { instructions })
export const approveMandate = (id, proposal) => post(part(id) + '/mandates', {
  expectedVersion: proposal.expectedVersion, mandate: proposal.mandate
})
export const listResearchSessions = id => get(part(id) + '/sessions')
export const createResearchSession = (id, question) => post(part(id) + '/sessions', { question })
export const runResearchSession = (id, sessionId) => post(part(id) + '/sessions/' + encodeURIComponent(sessionId) + '/run')
