
import { describe, it, expect, vi } from 'vitest'
import { createResearchThesisService, summarizeThesisHistory } from '../../src/services/researchPartner/researchThesis.js'
describe('RP-12 longitudinal thesis tracking', () => {
  it('counts observations and changes without deriving causes or return forecasts', () => {
    expect(summarizeThesisHistory([
      { assessment:'supported', recordedAt:'2026-01-01' },
      { assessment:'challenged', recordedAt:'2026-03-01' },
      { assessment:'challenged', recordedAt:'2026-05-01' }
    ])).toEqual({ latest:'challenged', assessments:3, transitions:1 })
  })
  it('requires session ownership and a completed source-backed report', async () => {
    const db = {
      researchPartner: { findFirst: vi.fn().mockResolvedValue({id:'p'}) },
      researchThesis: { findFirst: vi.fn().mockResolvedValue({id:'t',partnerId:'p'}) },
      researchSession: { findFirst: vi.fn().mockResolvedValue({
        id:'s', status:'completed', partnerId:'p', report:{
          evidence:[{id:'news:x'}],
          findings:[{claim:'More grid investment',assessment:'supported',evidenceIds:['news:x']}]
        } }) },
      researchThesisAssessment: { create: vi.fn().mockResolvedValue({id:'a'}) }
    }
    await createResearchThesisService(db).record('u','p','t','s',0)
    expect(db.researchSession.findFirst).toHaveBeenCalledWith({ where: { id:'s', partnerId:'p', status:'completed' } })
    expect(db.researchThesisAssessment.create).toHaveBeenCalledWith({data:
      {thesisId:'t',sessionId:'s',claim:'More grid investment',assessment:'supported',evidenceIds:['news:x']}})
  })
  it('rejects missing, forged and out-of-range evidence references', async () => {
    const db = {
      researchPartner: { findFirst: vi.fn().mockResolvedValue({id:'p'}) },
      researchThesis: { findFirst: vi.fn().mockResolvedValue({id:'t',partnerId:'p'}) },
      researchSession: { findFirst: vi.fn().mockResolvedValue({id:'s',status:'completed',report:{
        evidence:[],findings:[{claim:'Unsupported',assessment:'supported',evidenceIds:['madeup']}]
      }}) }
    }
    await expect(createResearchThesisService(db).record('u','p','t','s',0)).rejects.toThrow(/unavailable source/)
    await expect(createResearchThesisService(db).record('u','p','t','s',15)).rejects.toThrow(/Invalid/)
  })
})
